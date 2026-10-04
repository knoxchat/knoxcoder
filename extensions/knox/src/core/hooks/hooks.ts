/**
 * K-023: lifecycle hooks.
 *
 * Config (`.knox/hooks.json` in the workspace root):
 *
 *   { "hooks": { "PreToolUse": [
 *       { "matcher": "run_terminal_command|edit_file", "command": "./check.sh", "timeoutMs": 5000 }
 *   ] } }
 *
 * Events: PreToolUse, PostToolUse, UserPromptSubmit, Stop, SessionStart.
 * `matcher` is a regex tested against the tool name (with and without the
 * `builtin_` prefix); omit it or use "*" to match everything.
 *
 * Protocol: the hook command gets one JSON object on stdin
 * (`{event, cwd, toolName?, args?, result?, prompt?}`).
 *  - exit 0, stdout is JSON `{decision?, reason?, updatedArgs?, additionalContext?}`
 *    (or plain text, treated as `additionalContext`)
 *  - exit 2: deny (PreToolUse / UserPromptSubmit); stderr is the reason
 *  - any other exit code, a crash or a timeout: logged, never blocks
 * Hooks of one event run in config order; each PreToolUse hook sees the
 * arguments as modified by the previous one.
 */

import * as YAML from "yaml";

export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "Stop"
  | "SessionStart";

export const HOOK_EVENTS: readonly HookEvent[] = [
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Stop",
  "SessionStart",
];

export const DEFAULT_HOOK_TIMEOUT_MS = 10_000;

export interface HookDef {
  matcher?: string;
  command: string;
  timeoutMs?: number;
}

export type HooksConfig = Partial<Record<HookEvent, HookDef[]>>;

export interface HookPayload {
  toolName?: string;
  args?: Record<string, unknown>;
  result?: string;
  prompt?: string;
}

export interface HookExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type HookExec = (
  command: string,
  stdin: string,
  opts: { cwd?: string; timeoutMs: number },
) => Promise<HookExecResult>;

export interface HookAuditEntry {
  event: HookEvent;
  command: string;
  toolName?: string;
  outcome: "ok" | "deny" | "modify" | "context" | "error" | "timeout";
  durationMs: number;
  detail?: string;
}

export interface HookOutcome {
  denied?: { reason: string; command: string };
  args?: Record<string, unknown>;
  additionalContext: string[];
}

export function parseHooksConfig(raw: unknown): HooksConfig {
  const source =
    raw && typeof raw === "object" && "hooks" in (raw as object)
      ? (raw as { hooks: unknown }).hooks
      : raw;
  const out: HooksConfig = {};
  if (!source || typeof source !== "object") {
    return out;
  }
  for (const event of HOOK_EVENTS) {
    const list = (source as Record<string, unknown>)[event];
    if (!Array.isArray(list)) {
      continue;
    }
    const defs: HookDef[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const { command, matcher, timeoutMs } = item as Record<string, unknown>;
      if (typeof command !== "string" || !command.trim()) {
        continue;
      }
      defs.push({
        command,
        matcher: typeof matcher === "string" ? matcher : undefined,
        timeoutMs:
          typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : undefined,
      });
    }
    if (defs.length) {
      out[event] = defs;
    }
  }
  return out;
}

export function hookMatches(def: HookDef, toolName?: string): boolean {
  const m = def.matcher?.trim();
  if (!m || m === "*") {
    return true;
  }
  if (!toolName) {
    return false;
  }
  let re: RegExp;
  try {
    re = new RegExp(`^(?:${m})$`);
  } catch {
    return false;
  }
  return re.test(toolName) || re.test(toolName.replace(/^builtin_/, ""));
}

export const defaultHookExec: HookExec = async (command, stdin, opts) => {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, cwd: opts.cwd });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32") {
        child.kill();
      } else {
        child.kill("SIGKILL");
      }
      finish(null);
    }, opts.timeoutMs);
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      stderr += String(e);
      finish(null);
    });
    child.on("close", (code) => finish(code));
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(stdin);
  });
};

export class HookRunner {
  constructor(
    private readonly config: HooksConfig,
    private readonly opts: {
      cwd?: string;
      exec?: HookExec;
      onAudit?: (entry: HookAuditEntry) => void;
    } = {},
  ) {}

  has(event: HookEvent): boolean {
    return (this.config[event]?.length ?? 0) > 0;
  }

  async run(event: HookEvent, payload: HookPayload = {}): Promise<HookOutcome> {
    const outcome: HookOutcome = { additionalContext: [] };
    const exec = this.opts.exec ?? defaultHookExec;
    let args = payload.args;

    for (const def of this.config[event] ?? []) {
      if (!hookMatches(def, payload.toolName)) {
        continue;
      }
      const started = Date.now();
      const audit = (
        outcomeKind: HookAuditEntry["outcome"],
        detail?: string,
      ) =>
        this.opts.onAudit?.({
          event,
          command: def.command,
          toolName: payload.toolName,
          outcome: outcomeKind,
          durationMs: Date.now() - started,
          detail,
        });

      const res = await exec(
        def.command,
        JSON.stringify({ event, cwd: this.opts.cwd, ...payload, args }),
        { cwd: this.opts.cwd, timeoutMs: def.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS },
      ).catch(
        (e): HookExecResult => ({
          code: null,
          stdout: "",
          stderr: String(e),
          timedOut: false,
        }),
      );

      if (res.timedOut) {
        audit("timeout");
        continue;
      }
      if (res.code === 2) {
        const reason = res.stderr.trim() || res.stdout.trim() || "Blocked by hook";
        audit("deny", reason);
        if (event === "PreToolUse" || event === "UserPromptSubmit") {
          outcome.denied = { reason, command: def.command };
          return outcome;
        }
        continue;
      }
      if (res.code !== 0) {
        audit("error", res.stderr.trim() || `exit ${res.code}`);
        continue;
      }

      const text = res.stdout.trim();
      let parsed: Record<string, unknown> | null = null;
      if (text.startsWith("{")) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }
      if (!parsed) {
        if (text) {
          outcome.additionalContext.push(text);
          audit("context");
        } else {
          audit("ok");
        }
        continue;
      }
      if (
        parsed.decision === "deny" &&
        (event === "PreToolUse" || event === "UserPromptSubmit")
      ) {
        const reason =
          typeof parsed.reason === "string" ? parsed.reason : "Blocked by hook";
        audit("deny", reason);
        outcome.denied = { reason, command: def.command };
        return outcome;
      }
      let kind: HookAuditEntry["outcome"] = "ok";
      if (
        event === "PreToolUse" &&
        parsed.updatedArgs &&
        typeof parsed.updatedArgs === "object" &&
        !Array.isArray(parsed.updatedArgs)
      ) {
        args = parsed.updatedArgs as Record<string, unknown>;
        outcome.args = args;
        kind = "modify";
      }
      if (
        typeof parsed.additionalContext === "string" &&
        parsed.additionalContext.trim()
      ) {
        outcome.additionalContext.push(parsed.additionalContext.trim());
        if (kind === "ok") {
          kind = "context";
        }
      }
      audit(kind);
    }
    return outcome;
  }
}

/**
 * Extract the top-level `hooks:` block from config.yaml text (same shape as
 * hooks.json: event name -> list of {matcher, command, timeoutMs}).
 * Invalid YAML or a missing block gives an empty config.
 */
export function parseHooksFromYaml(rawYaml: string): HooksConfig {
  if (!rawYaml.trim()) {
    return {};
  }
  try {
    const doc = YAML.parse(rawYaml);
    if (doc && typeof doc === "object" && !Array.isArray(doc)) {
      return parseHooksConfig((doc as { hooks?: unknown }).hooks);
    }
  } catch {
    // ignore
  }
  return {};
}

/** Concatenate configs in order: earlier sources run first (global, then workspace). */
export function mergeHooksConfigs(...configs: HooksConfig[]): HooksConfig {
  const out: HooksConfig = {};
  for (const cfg of configs) {
    for (const event of HOOK_EVENTS) {
      const defs = cfg[event];
      if (defs?.length) {
        out[event] = [...(out[event] ?? []), ...defs];
      }
    }
  }
  return out;
}

/** Load `.knox/hooks.json` from a workspace root. Missing or invalid files give an empty config. */
export async function loadHooksConfig(
  readFile: (uri: string) => Promise<string>,
  workspaceDir: string,
): Promise<HooksConfig> {
  try {
    const base = workspaceDir.replace(/\/+$/, "");
    return parseHooksConfig(JSON.parse(await readFile(`${base}/.knox/hooks.json`)));
  } catch {
    return {};
  }
}
