/**
 * `knox` CLI entry point (K-029).
 *
 *   knox login                 sign in through the browser (OAuth + PKCE)
 *   knox whoami | logout
 *   knox run "<task>" ...      headless agent run, uses the signed-in session
 *
 * No API keys: credentials come only from `knox login`.
 *   npx tsx cli/main.ts run "fix the failing test" --permission fullAuto --json
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  exportTeamBundle,
  importTeamBundle,
  parseTeamBundle,
} from "../config/teamBundle";

import { apiBase, loginWithKnoxChat, logoutKnoxChat } from "../auth/knoxOAuth";
import { createLiveLlm } from "../eval/liveLlm";
import {
  clearSession,
  loadSession,
  saveSession,
} from "./credentials";
import {
  bgRoot,
  createJob,
  desktopNotify,
  discardJob,
  formatJobLine,
  listJobs,
  loadJob,
  mergeJob,
  runJob,
} from "./background";
import { CLI_USAGE, parseCliArgs, runHeadless } from "./headless";

const DEFAULT_MODEL = "qwen/qwen3-coder";

function openBrowser(url: string): Promise<void> {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url.replace(/&/g, "^&")]]
        : ["xdg-open", [url]];
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function login(): Promise<number> {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  try {
    const session = await loginWithKnoxChat({
      openBrowser: async (url) => {
        process.stderr.write(`Opening your browser to sign in.\nIf it does not open, visit:\n${url}\n`);
        await openBrowser(url).catch(() => undefined);
      },
      onState: (state) => process.stderr.write(`[${state}]\n`),
      page: {
        lang: "en",
        title: "Knox",
        body: "Signed in. You can close this window and return to the terminal.",
      },
      signal: controller.signal,
    });
    saveSession(session);
    process.stdout.write(`Signed in as @${session.account.username || session.account.userId}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`knox: sign-in failed (${error instanceof Error ? error.message : error})\n`);
    return 1;
  }
}

async function logout(): Promise<number> {
  const session = loadSession();
  if (session) {
    await logoutKnoxChat({
      apiKey: session.apiKey,
      refreshToken: session.refreshToken,
    }).catch(() => false);
  }
  clearSession();
  process.stdout.write("Signed out.\n");
  return 0;
}

/** `knox bg start|list|show|merge|discard` and the detached `bg-run` worker. */
async function background(argv: string[]): Promise<number> {
  const root = bgRoot();
  const [sub, ...rest] = argv;
  if (sub === "start") {
    const parsed = parseCliArgs(rest);
    if ("error" in parsed || parsed.help) {
      process.stderr.write(`knox bg start "<task>" [run options]\n${"error" in parsed ? parsed.error : ""}\n`);
      return 64;
    }
    if (!loadSession()) {
      process.stderr.write("knox: not signed in. Run: knox login\n");
      return 64;
    }
    const flags = [
      "--permission", parsed.permission,
      "--profile", parsed.profile,
      ...(parsed.maxSteps ? ["--max-steps", String(parsed.maxSteps)] : []),
      ...(parsed.model ? ["--model", parsed.model] : []),
    ];
    const job = createJob({ root, dir: parsed.dir, task: parsed.task, args: flags });
    const child = spawn(
      process.execPath,
      [...process.execArgv, process.argv[1], "bg-run", job.id],
      { detached: true, stdio: "ignore" },
    );
    child.unref();
    process.stdout.write(`started ${job.id} on ${job.branch}\nworktree: ${job.worktree}\n`);
    return 0;
  }
  if (sub === "list" || sub === undefined) {
    const jobs = listJobs(root);
    process.stdout.write(jobs.length ? `${jobs.map(formatJobLine).join("\n")}\n` : "No background jobs.\n");
    return 0;
  }
  const id = rest[0];
  const job = id ? loadJob(root, id) : undefined;
  if (!job) {
    process.stderr.write(`knox bg ${sub}: unknown or missing job id\n`);
    return 64;
  }
  if (sub === "show") {
    process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
    return 0;
  }
  if (sub === "merge" || sub === "discard") {
    const out = sub === "merge" ? mergeJob(root, job.id) : discardJob(root, job.id);
    process.stdout.write(`${out.message}\n`);
    return out.ok ? 0 : 1;
  }
  process.stderr.write("usage: knox bg start|list|show|merge|discard\n");
  return 64;
}

/** `knox team export [file] [--dir d]` / `knox team import <file> [--dir d] [--force] [--allow-hooks] [--dry-run]` */
function team(argv: string[]): number {
  const [sub, ...rest] = argv;
  const flag = (name: string) => rest.includes(name);
  const value = (name: string) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const dir = path.resolve(value("--dir") ?? process.cwd());
  const positional = rest.filter((a, i) => !a.startsWith("--") && rest[i - 1] !== "--dir");
  if (sub === "export") {
    const out = positional[0] ?? "knox-team-bundle.json";
    const { bundle, skipped } = exportTeamBundle(dir);
    fs.writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`);
    process.stdout.write(`wrote ${bundle.files.length} files to ${out}\n`);
    for (const s of skipped) process.stderr.write(`skipped ${s.path}: ${s.reason}\n`);
    return 0;
  }
  if (sub === "import" && positional[0]) {
    const parsed = parseTeamBundle(fs.readFileSync(positional[0], "utf-8"));
    if ("error" in parsed) {
      process.stderr.write(`knox team import: ${parsed.error}\n`);
      return 1;
    }
    const res = importTeamBundle(parsed, dir, {
      overwrite: flag("--force"),
      allowHooks: flag("--allow-hooks"),
      dryRun: flag("--dry-run"),
    });
    process.stdout.write(`${flag("--dry-run") ? "would write" : "wrote"} ${res.written.length} files\n`);
    for (const s of res.skipped) process.stderr.write(`skipped ${s.path}: ${s.reason}\n`);
    return 0;
  }
  process.stderr.write("usage: knox team export [file] | knox team import <file> [--force] [--allow-hooks] [--dry-run] [--dir d]\n");
  return 64;
}

async function backgroundWorker(id: string): Promise<number> {
  const session = loadSession();
  await runJob({
    root: bgRoot(),
    id,
    notify: desktopNotify,
    run: async (job) => {
      if (!session) throw new Error("not signed in");
      const parsed = parseCliArgs([...job.args, job.task]);
      if ("error" in parsed) throw new Error(parsed.error);
      const live = createLiveLlm({
        apiKey: session.apiKey,
        model: parsed.model ?? DEFAULT_MODEL,
        baseUrl: `${apiBase()}/v1`,
      });
      return runHeadless({
        task: job.task,
        workspaceDir: job.worktree,
        llm: live.llm,
        permission: parsed.permission,
        profile: parsed.profile,
        maxSteps: parsed.maxSteps,
        trustWorkspaceHooks: parsed.trustHooks,
      });
    },
  });
  return 0;
}

async function main(): Promise<number> {
  const command = process.argv[2];
  if (command === "team") return team(process.argv.slice(3));
  if (command === "bg") return background(process.argv.slice(3));
  if (command === "bg-run") return backgroundWorker(process.argv[3] ?? "");
  if (command === "login") return login();
  if (command === "logout") return logout();
  if (command === "whoami") {
    const s = loadSession();
    process.stdout.write(
      s ? `@${s.account.username || s.account.userId}\n` : "Not signed in. Run: knox login\n",
    );
    return s ? 0 : 1;
  }

  const parsed = parseCliArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(`knox: ${parsed.error}\n\n${CLI_USAGE}\n`);
    return 64;
  }
  if (parsed.help) {
    process.stdout.write(`${CLI_USAGE}\n`);
    return 0;
  }
  const session = loadSession();
  if (!session) {
    process.stderr.write("knox: not signed in. Run: knox login\n");
    return 64;
  }
  const live = createLiveLlm({
    apiKey: session.apiKey,
    model: parsed.model ?? DEFAULT_MODEL,
    baseUrl: `${apiBase()}/v1`,
  });
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());

  const result = await runHeadless({
    task: parsed.task,
    workspaceDir: parsed.dir,
    llm: live.llm,
    permission: parsed.permission,
    profile: parsed.profile,
    maxSteps: parsed.maxSteps,
    trustWorkspaceHooks: parsed.trustHooks,
    abortSignal: controller.signal,
    onEvent: (e) => {
      if (parsed.streamJson) {
        process.stdout.write(`${JSON.stringify(e)}\n`);
        return;
      }
      if (parsed.json) return;
      if (e.type === "tool") {
        process.stderr.write(`${e.ok ? "ok " : "ERR"} ${e.name}\n`);
      } else if (e.type === "denied") {
        process.stderr.write(`DENIED ${e.name} (needs approval; headless)\n`);
      }
    },
  });

  if (parsed.streamJson) {
    process.stdout.write(
      `${JSON.stringify({ type: "result", ...result, usage: live.usage })}\n`,
    );
  } else if (parsed.json) {
    process.stdout.write(
      `${JSON.stringify({ ...result, usage: live.usage }, null, 2)}\n`,
    );
  } else {
    process.stdout.write(`${result.summary}\n`);
    process.stderr.write(
      `[${result.stoppedReason}] ${result.steps} steps, ${live.usage.promptTokens + live.usage.completionTokens} tokens\n`,
    );
  }
  return result.exitCode;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`knox: ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  },
);
