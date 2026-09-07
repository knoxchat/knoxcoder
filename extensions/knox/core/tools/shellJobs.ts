/**
 * Background / long-running shell jobs for builtin_run_terminal_command
 * and builtin_await_shell (Claude TaskOutput / Monitor lite).
 */
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ToolCallError, ToolCallErrorCode } from "./errors";
import { spawnNativePty } from "./nativePty";

export const MAX_SHELL_OUTPUT_CHARS = 200_000;
export const DEFAULT_BLOCK_UNTIL_MS = 30_000;
/** Stay under the terminal middleware timeout so we background instead of abort. */
export const SHELL_WAIT_HARD_CAP_MS = 110_000;
/** Default `builtin_await_shell` wait when timeout_ms is omitted (HL-14). */
export const DEFAULT_AWAIT_TIMEOUT_MS = 600_000;
const MIN_AWAIT_TIMEOUT_MS = 1_000;
const MAX_AWAIT_TIMEOUT_MS = 3_600_000;

export interface AgentJobsOptions {
  logDir?: string;
  awaitTimeoutMs?: number;
}

let agentJobsOptions: AgentJobsOptions = {};

function expandUserPath(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function clampAwaitTimeoutMs(value: number): number {
  return Math.min(
    MAX_AWAIT_TIMEOUT_MS,
    Math.max(MIN_AWAIT_TIMEOUT_MS, Math.floor(value)),
  );
}

/** Apply `agent.jobs` from config.yaml. Empty values restore defaults. */
export function applyAgentJobsOptions(opts?: AgentJobsOptions | null): void {
  agentJobsOptions = {
    logDir: opts?.logDir?.trim() || undefined,
    awaitTimeoutMs:
      typeof opts?.awaitTimeoutMs === "number" &&
      Number.isFinite(opts.awaitTimeoutMs)
        ? clampAwaitTimeoutMs(opts.awaitTimeoutMs)
        : undefined,
  };
}

export function resolveAwaitTimeoutMs(): number {
  return agentJobsOptions.awaitTimeoutMs ?? DEFAULT_AWAIT_TIMEOUT_MS;
}

/** Directory for job logs (`~/.knox/jobs` or `agent.jobs.logDir`). */
export function getJobsLogDir(): string {
  return knoxJobsLogDir();
}
/** Extra middleware budget so a requested wait is not killed as EXECUTION_TIMEOUT. */
export const TOOL_TIMEOUT_SLACK_MS = 10_000;
export const PARTIAL_OUTPUT_THROTTLE_MS = 100;
/** Panel / webview job rows — slower than tool-card streaming. */
export const JOB_PANEL_UPDATE_MS = 250;
const FORCE_KILL_MS = 2_000;
export const JOB_LOG_BODY_MARKER = "# ---\n";

const LONG_RUNNING_COMMAND_RE =
  /(?:^|[\s;|&])(?:make|gmake|ninja|cmake\s+--build|\.\/configure|meson\s+compile|qemu-system-[\w-]+|cargo(?:\s+\+\S+)?\s+(?:check|build|test|clippy|nextest|bench|doc|miri))\b/i;

export type ShellJobStatus = "running" | "exited" | "killed";
export type ShellJobEvent = "started" | "updated" | "completed";
export type ShellJobListener = (
  event: ShellJobEvent,
  snapshot: ShellJobSnapshot,
) => void;

/** Completed jobs kept for the background panel; running jobs are never pruned. */
export const MAX_COMPLETED_SHELL_JOBS = 20;

export interface ShellJobSnapshot {
  id: string;
  command: string;
  cwd: string;
  startedAt: number;
  endedAt?: number;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  status: ShellJobStatus;
  truncated: boolean;
  /** Full untruncated log on disk (HL-09 / HL-15). */
  logPath?: string;
  /** Bytes of interleaved stdout+stderr written (log body / since_byte). */
  outputBytes?: number;
  /** Interactive stdin is open (HL-13). */
  stdin?: boolean;
  /** True when spawned via node-pty (or a test double). */
  ptyNative?: boolean;
}

interface NativeJobHandle {
  write: (data: string) => boolean;
  close: () => boolean;
  kill: (signal: NodeJS.Signals) => void;
}

interface ShellJobInternal {
  snapshot: ShellJobSnapshot;
  child?: childProcess.ChildProcess;
  native?: NativeJobHandle;
  waiters: Array<() => void>;
  outputWaiters: Array<() => void>;
  onOutput?: (snapshot: ShellJobSnapshot) => void;
  onComplete?: (snapshot: ShellJobSnapshot) => void;
  finished: boolean;
  panelEmit?: ReturnType<typeof createThrottledSnapshotEmitter>;
  readCursor: number;
}

const jobs = new Map<string, ShellJobInternal>();
const listeners = new Set<ShellJobListener>();
let jobSeq = 0;

export function subscribeShellJobs(listener: ShellJobListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitShellJob(event: ShellJobEvent, snapshot: ShellJobSnapshot): void {
  const copy = { ...snapshot };
  for (const listener of listeners) {
    try {
      listener(event, copy);
    } catch {
      // Panel listeners must not break the job
    }
  }
}

function pruneCompletedShellJobs(): void {
  const completed = [...jobs.values()].filter(
    (job) => job.snapshot.status !== "running",
  );
  if (completed.length <= MAX_COMPLETED_SHELL_JOBS) {
    return;
  }
  completed.sort(
    (a, b) => (a.snapshot.endedAt ?? 0) - (b.snapshot.endedAt ?? 0),
  );
  const extra = completed.length - MAX_COMPLETED_SHELL_JOBS;
  for (let i = 0; i < extra; i++) {
    jobs.delete(completed[i].snapshot.id);
  }
}

export function extraShellPathDirs(home = os.homedir()): string[] {
  return [
    path.join(home, ".cargo", "bin"),
    path.join(home, "go", "bin"),
    path.join(home, ".local", "bin"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
  ];
}

/**
 * GUI-launched VS Code often has a stripped PATH (no cargo, brew, go).
 * Prepend common user bin dirs that actually exist.
 */
export function buildShellEnv(
  base: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
): NodeJS.ProcessEnv {
  const env = { ...base };
  const pathKey =
    process.platform === "win32" && env.Path !== undefined && env.PATH === undefined
      ? "Path"
      : "PATH";
  const current = env[pathKey] ?? env.PATH ?? env.Path ?? "";
  const parts = current.split(path.delimiter).filter(Boolean);
  const seen = new Set(parts);
  const prepend: string[] = [];
  for (const dir of extraShellPathDirs(home)) {
    if (seen.has(dir)) {
      continue;
    }
    try {
      if (!fs.existsSync(dir)) {
        continue;
      }
    } catch {
      continue;
    }
    seen.add(dir);
    prepend.push(dir);
  }
  if (prepend.length > 0) {
    env[pathKey] = [...prepend, ...parts].join(path.delimiter);
  }
  return env;
}

export function killProcessTree(
  child: childProcess.ChildProcess,
  signal: NodeJS.Signals = "SIGTERM",
): void {
  const pid = child.pid;
  if (pid == null) {
    return;
  }
  if (process.platform === "win32") {
    childProcess.spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Process may already be gone
    }
  }
}

export function nextShellJobId(prefix = "sh"): string {
  jobSeq += 1;
  return `${prefix}_${jobSeq.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function knoxJobsLogDir(): string {
  const override = agentJobsOptions.logDir;
  if (override) {
    return path.resolve(expandUserPath(override));
  }
  const root =
    process.env.KNOX_GLOBAL_DIR ??
    (process.env.VITEST
      ? path.join(os.tmpdir(), "knox-vitest")
      : path.join(os.homedir(), ".knox"));
  return path.join(root, "jobs");
}

export function isLongRunningCommand(command: string): boolean {
  if (!command) {
    return false;
  }
  return LONG_RUNNING_COMMAND_RE.test(command);
}

export function resolveTerminalWaitMs(params: {
  command: string;
  background: boolean;
  explicitWait: boolean;
  blockUntilMs: number;
}): number {
  if (params.background) {
    return 0;
  }
  if (!params.explicitWait && isLongRunningCommand(params.command)) {
    return 0;
  }
  return resolveWaitMs(params.blockUntilMs);
}

function appendJobLog(job: ShellJobInternal, chunk: string): void {
  const logPath = job.snapshot.logPath;
  if (!logPath || !chunk) {
    return;
  }
  try {
    fs.appendFileSync(logPath, chunk);
  } catch {
    job.snapshot.logPath = undefined;
  }
}

function openJobLog(
  id: string,
  command: string,
  cwd: string,
): string | undefined {
  try {
    const dir = knoxJobsLogDir();
    fs.mkdirSync(dir, { recursive: true });
    const logPath = path.join(dir, `${id}.log`);
    fs.writeFileSync(
      logPath,
      `# command: ${command}\n# cwd: ${cwd}\n# started: ${new Date().toISOString()}\n${JOB_LOG_BODY_MARKER}`,
    );
    return logPath;
  } catch {
    return undefined;
  }
}

export function readJobLogBody(logPath: string, sinceByte = 0): string {
  try {
    const raw = fs.readFileSync(logPath);
    const marker = Buffer.from(JOB_LOG_BODY_MARKER);
    const idx = raw.indexOf(marker);
    const body = idx >= 0 ? raw.subarray(idx + marker.length) : raw;
    const start = Math.min(Math.max(0, sinceByte), body.length);
    return body.subarray(start).toString("utf8");
  } catch {
    return "";
  }
}

export function jobOutputSince(
  snapshot: ShellJobSnapshot,
  sinceByte = 0,
): string {
  if (snapshot.logPath) {
    return readJobLogBody(snapshot.logPath, sinceByte);
  }
  const combined = `${snapshot.stdout}${snapshot.stderr}`;
  const buf = Buffer.from(combined, "utf8");
  const start = Math.min(Math.max(0, sinceByte), buf.length);
  return buf.subarray(start).toString("utf8");
}

function appendCapped(
  current: string,
  chunk: string,
): { text: string; truncated: boolean } {
  const next = current + chunk;
  if (next.length <= MAX_SHELL_OUTPUT_CHARS) {
    return { text: next, truncated: false };
  }
  return {
    text: next.slice(next.length - MAX_SHELL_OUTPUT_CHARS),
    truncated: true,
  };
}

function notifyWaiters(job: ShellJobInternal): void {
  const waiters = job.waiters.splice(0);
  for (const waiter of waiters) {
    waiter();
  }
}

function notifyOutputWaiters(job: ShellJobInternal): void {
  const waiters = job.outputWaiters.splice(0);
  for (const waiter of waiters) {
    waiter();
  }
}

function cancelledError(toolName = "builtin_run_terminal_command"): ToolCallError {
  return new ToolCallError({
    code: ToolCallErrorCode.CANCELLED,
    message: "Terminal command cancelled",
    toolName,
    retryable: false,
  });
}

function finishJob(job: ShellJobInternal): void {
  if (job.finished) {
    return;
  }
  job.finished = true;
  job.panelEmit?.flush();
  job.snapshot.endedAt = Date.now();
  job.onComplete?.({ ...job.snapshot });
  emitShellJob("completed", job.snapshot);
  notifyWaiters(job);
  notifyOutputWaiters(job);
  pruneCompletedShellJobs();
}

function killJobProcess(
  job: ShellJobInternal,
  signal: NodeJS.Signals,
): void {
  if (job.native) {
    job.native.kill(signal);
    return;
  }
  if (job.child) {
    killProcessTree(job.child, signal);
  }
}

function createJobRecord(opts: {
  id: string;
  display: string;
  cwd: string;
  stdin?: boolean;
  ptyNative?: boolean;
  logPath?: string;
  onOutput?: (snapshot: ShellJobSnapshot) => void;
  onComplete?: (snapshot: ShellJobSnapshot) => void;
}): ShellJobInternal {
  const job: ShellJobInternal = {
    snapshot: {
      id: opts.id,
      command: opts.display,
      cwd: opts.cwd,
      startedAt: Date.now(),
      stdout: "",
      stderr: "",
      exitCode: null,
      status: "running",
      truncated: false,
      logPath: opts.logPath,
      outputBytes: 0,
      stdin: opts.stdin || undefined,
      ptyNative: opts.ptyNative || undefined,
    },
    waiters: [],
    outputWaiters: [],
    onOutput: opts.onOutput,
    onComplete: opts.onComplete,
    finished: false,
    readCursor: 0,
  };
  job.panelEmit = createThrottledSnapshotEmitter((snap) => {
    if (!job.finished) {
      emitShellJob("updated", snap);
    }
  }, JOB_PANEL_UPDATE_MS);
  return job;
}

function attachJobOutput(job: ShellJobInternal): {
  onChunk: (stream: "stdout" | "stderr", chunk: Buffer | string) => void;
} {
  const emit = () => {
    const snap = { ...job.snapshot };
    job.onOutput?.(snap);
    job.panelEmit?.push(snap);
    notifyOutputWaiters(job);
  };
  const onChunk = (stream: "stdout" | "stderr", chunk: Buffer | string) => {
    const text = chunk.toString();
    job.snapshot.outputBytes =
      (job.snapshot.outputBytes ?? 0) + Buffer.byteLength(text);
    appendJobLog(job, text);
    const cap = appendCapped(job.snapshot[stream], text);
    job.snapshot[stream] = cap.text;
    if (cap.truncated) {
      job.snapshot.truncated = true;
    }
    emit();
  };
  return { onChunk };
}

function tryStartNativePtyJob(opts: {
  id: string;
  command: string;
  display: string;
  cwd: string;
  logPath?: string;
  onOutput?: (snapshot: ShellJobSnapshot) => void;
  onComplete?: (snapshot: ShellJobSnapshot) => void;
}): ShellJobInternal | null {
  const pty = spawnNativePty({
    command: opts.command,
    cwd: opts.cwd,
    env: buildShellEnv(),
  });
  if (!pty) {
    return null;
  }
  const job = createJobRecord({
    id: opts.id,
    display: opts.display,
    cwd: opts.cwd,
    stdin: true,
    ptyNative: true,
    logPath: opts.logPath,
    onOutput: opts.onOutput,
    onComplete: opts.onComplete,
  });
  job.native = {
    write: (data) => {
      pty.write(data);
      return true;
    },
    close: () => {
      pty.write("\x04");
      return true;
    },
    kill: (signal) => {
      if (signal === "SIGINT") {
        pty.write("\x03");
        return;
      }
      pty.kill(signal);
    },
  };
  const { onChunk } = attachJobOutput(job);
  pty.onData((data) => {
    onChunk("stdout", data);
  });
  pty.onExit((event) => {
    if (job.snapshot.status === "running") {
      job.snapshot.status = "exited";
      job.snapshot.exitCode = event.exitCode ?? 1;
    } else if (
      job.snapshot.status === "killed" &&
      job.snapshot.exitCode == null
    ) {
      job.snapshot.exitCode = event.exitCode ?? 1;
    }
    finishJob(job);
  });
  return job;
}

export function startShellJob(opts: {
  command: string;
  displayCommand?: string;
  cwd: string;
  stdin?: boolean;
  idPrefix?: string;
  nativePty?: boolean;
  onOutput?: (snapshot: ShellJobSnapshot) => void;
  onComplete?: (snapshot: ShellJobSnapshot) => void;
}): string {
  const id = nextShellJobId(opts.idPrefix ?? "sh");
  const display = opts.displayCommand ?? opts.command;
  const logPath = openJobLog(id, display, opts.cwd);

  if (opts.nativePty) {
    const nativeJob = tryStartNativePtyJob({
      id,
      command: opts.command,
      display,
      cwd: opts.cwd,
      logPath,
      onOutput: opts.onOutput,
      onComplete: opts.onComplete,
    });
    if (nativeJob) {
      jobs.set(id, nativeJob);
      emitShellJob("started", nativeJob.snapshot);
      return id;
    }
  }

  const child = childProcess.spawn(opts.command, {
    cwd: opts.cwd,
    env: buildShellEnv(),
    shell: true,
    // Own process group so kill() stops pipelines (cargo | grep), not just sh.
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: [opts.stdin ? "pipe" : "ignore", "pipe", "pipe"],
  });

  const job = createJobRecord({
    id,
    display,
    cwd: opts.cwd,
    stdin: opts.stdin,
    logPath,
    onOutput: opts.onOutput,
    onComplete: opts.onComplete,
  });
  job.child = child;
  jobs.set(id, job);
  emitShellJob("started", job.snapshot);

  const { onChunk } = attachJobOutput(job);

  child.stdout?.on("data", (chunk: Buffer | string) => {
    onChunk("stdout", chunk);
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    onChunk("stderr", chunk);
  });

  child.on("error", (error) => {
    if (job.snapshot.status === "running") {
      job.snapshot.status = "exited";
      job.snapshot.exitCode = 1;
    }
    const message = `\n${error.message}\n`;
    job.snapshot.outputBytes =
      (job.snapshot.outputBytes ?? 0) + Buffer.byteLength(message);
    const cap = appendCapped(
      job.snapshot.stderr,
      (job.snapshot.stderr ? "\n" : "") + error.message,
    );
    job.snapshot.stderr = cap.text;
    job.snapshot.truncated ||= cap.truncated;
    appendJobLog(job, message);
    finishJob(job);
  });

  child.on("close", (code) => {
    if (job.snapshot.status === "running") {
      job.snapshot.status = "exited";
      job.snapshot.exitCode = code ?? 1;
    } else if (job.snapshot.status === "killed" && job.snapshot.exitCode == null) {
      job.snapshot.exitCode = code ?? 1;
    }
    finishJob(job);
  });

  return id;
}

export function writeShellJobStdin(id: string, data: string): boolean {
  const job = jobs.get(id.trim());
  if (!job || job.snapshot.status !== "running") {
    return false;
  }
  if (job.native) {
    return job.native.write(data);
  }
  const stdin = job.child?.stdin;
  if (!stdin || stdin.destroyed || stdin.writableEnded) {
    return false;
  }
  stdin.write(data);
  return true;
}

export function closeShellJobStdin(id: string): boolean {
  const job = jobs.get(id.trim());
  if (!job) {
    return false;
  }
  if (job.native) {
    return job.native.close();
  }
  const stdin = job.child?.stdin;
  if (!stdin || stdin.destroyed || stdin.writableEnded) {
    return false;
  }
  stdin.end();
  return true;
}

export function signalShellJob(
  id: string,
  signal: NodeJS.Signals = "SIGINT",
): boolean {
  const job = jobs.get(id.trim());
  if (!job || job.snapshot.status !== "running") {
    return false;
  }
  killJobProcess(job, signal);
  return true;
}

export function getShellJobReadCursor(id: string): number {
  return jobs.get(id.trim())?.readCursor ?? 0;
}

export function setShellJobReadCursor(id: string, cursor: number): void {
  const job = jobs.get(id.trim());
  if (job) {
    job.readCursor = Math.max(0, cursor);
  }
}

export function getShellJob(id: string): ShellJobSnapshot | undefined {
  const job = jobs.get(id.trim());
  return job ? { ...job.snapshot } : undefined;
}

export function listShellJobs(): ShellJobSnapshot[] {
  return [...jobs.values()].map((job) => ({ ...job.snapshot }));
}

export function killAllRunningShellJobs(): ShellJobSnapshot[] {
  const killed: ShellJobSnapshot[] = [];
  for (const job of [...jobs.values()]) {
    if (job.snapshot.status !== "running") {
      continue;
    }
    const snapshot = killShellJob(job.snapshot.id);
    if (snapshot) {
      killed.push(snapshot);
    }
  }
  return killed;
}

export function killShellJob(id: string): ShellJobSnapshot | undefined {
  const job = jobs.get(id.trim());
  if (!job) {
    return undefined;
  }
  if (job.snapshot.status !== "running") {
    return { ...job.snapshot };
  }

  killJobProcess(job, "SIGTERM");
  setTimeout(() => {
    if (job.snapshot.status === "killed" && job.snapshot.endedAt == null) {
      killJobProcess(job, "SIGKILL");
    }
  }, FORCE_KILL_MS);

  job.snapshot.status = "killed";
  if (job.snapshot.exitCode == null) {
    job.snapshot.exitCode = 1;
  }
  const snapshot = { ...job.snapshot };
  emitShellJob("updated", snapshot);
  return snapshot;
}

export function dismissShellJob(id: string): boolean {
  const job = jobs.get(id.trim());
  if (!job || job.snapshot.status === "running") {
    return false;
  }
  jobs.delete(id.trim());
  return true;
}

export function dismissCompletedShellJobs(): number {
  let removed = 0;
  for (const [id, job] of [...jobs.entries()]) {
    if (job.snapshot.status === "running") {
      continue;
    }
    jobs.delete(id);
    removed += 1;
  }
  return removed;
}

export function waitForShellJob(
  id: string,
  opts: {
    timeoutMs?: number;
    abortSignal?: AbortSignal;
    killOnAbort?: boolean;
    toolName?: string;
  } = {},
): Promise<ShellJobSnapshot> {
  const job = jobs.get(id.trim());
  if (!job) {
    return Promise.reject(new Error(`Unknown shell job: ${id}`));
  }
  if (job.snapshot.status !== "running") {
    return Promise.resolve({ ...job.snapshot });
  }

  const timeoutMs = opts.timeoutMs;
  if (timeoutMs === 0) {
    return Promise.resolve({ ...job.snapshot });
  }

  if (opts.abortSignal?.aborted) {
    if (opts.killOnAbort) {
      killShellJob(id);
      return Promise.reject(cancelledError(opts.toolName));
    }
    return Promise.resolve({ ...job.snapshot });
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      opts.abortSignal?.removeEventListener("abort", onAbort);
      job.waiters = job.waiters.filter((waiter) => waiter !== onDone);
      fn();
    };

    const onDone = () => {
      finish(() => {
        if (opts.killOnAbort && opts.abortSignal?.aborted) {
          reject(cancelledError(opts.toolName));
          return;
        }
        resolve({ ...job.snapshot });
      });
    };

    const onAbort = () => {
      if (opts.killOnAbort) {
        killShellJob(id);
        finish(() => reject(cancelledError(opts.toolName)));
        return;
      }
      finish(() => resolve({ ...job.snapshot }));
    };

    job.waiters.push(onDone);
    opts.abortSignal?.addEventListener("abort", onAbort, { once: true });

    if (timeoutMs !== undefined && timeoutMs > 0) {
      timer = setTimeout(() => {
        finish(() => resolve({ ...job.snapshot }));
      }, timeoutMs);
    }
  });
}

export function waitForShellOutput(
  id: string,
  opts: {
    sinceByte?: number;
    timeoutMs?: number;
    abortSignal?: AbortSignal;
  } = {},
): Promise<ShellJobSnapshot> {
  const job = jobs.get(id.trim());
  if (!job) {
    return Promise.reject(new Error(`Unknown shell job: ${id}`));
  }

  const sinceByte = opts.sinceByte ?? job.readCursor;
  const timeoutMs = opts.timeoutMs ?? 5_000;

  if (
    (job.snapshot.outputBytes ?? 0) > sinceByte ||
    job.snapshot.status !== "running" ||
    timeoutMs === 0
  ) {
    return Promise.resolve({ ...job.snapshot });
  }

  if (opts.abortSignal?.aborted) {
    return Promise.resolve({ ...job.snapshot });
  }

  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      opts.abortSignal?.removeEventListener("abort", onAbort);
      job.outputWaiters = job.outputWaiters.filter((waiter) => waiter !== onOutput);
      resolve({ ...job.snapshot });
    };

    const onOutput = () => {
      if (
        (job.snapshot.outputBytes ?? 0) > sinceByte ||
        job.snapshot.status !== "running"
      ) {
        finish();
      }
    };

    const onAbort = () => finish();

    job.outputWaiters.push(onOutput);
    opts.abortSignal?.addEventListener("abort", onAbort, { once: true });

    if (
      (job.snapshot.outputBytes ?? 0) > sinceByte ||
      job.snapshot.status !== "running"
    ) {
      finish();
      return;
    }

    if (timeoutMs > 0) {
      timer = setTimeout(finish, timeoutMs);
    }
  });
}

export function resetShellJobs(): void {
  for (const job of jobs.values()) {
    if (job.snapshot.status === "running") {
      killJobProcess(job, "SIGKILL");
    }
  }
  jobs.clear();
  jobSeq = 0;
  applyAgentJobsOptions(null);
}

export function createThrottledSnapshotEmitter(
  emit: (snapshot: ShellJobSnapshot) => void,
  intervalMs = PARTIAL_OUTPUT_THROTTLE_MS,
): { push: (snapshot: ShellJobSnapshot) => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: ShellJobSnapshot | undefined;
  let first = true;

  return {
    push(snapshot) {
      pending = snapshot;
      if (first) {
        first = false;
        emit(snapshot);
        return;
      }
      if (timer) {
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        if (pending) {
          emit(pending);
          pending = undefined;
        }
      }, intervalMs);
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (pending) {
        emit(pending);
        pending = undefined;
      }
    },
  };
}

export function parseBlockUntilMs(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_BLOCK_UNTIL_MS;
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return DEFAULT_BLOCK_UNTIL_MS;
  }
  return Math.floor(n);
}

export function resolveWaitMs(blockUntilMs: number): number {
  if (blockUntilMs === 0) {
    return SHELL_WAIT_HARD_CAP_MS;
  }
  return Math.min(blockUntilMs, SHELL_WAIT_HARD_CAP_MS);
}
