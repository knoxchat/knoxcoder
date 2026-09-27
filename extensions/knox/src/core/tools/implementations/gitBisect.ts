import type { ContextItem } from "../..";
import { ToolImpl } from ".";
import {
  formatGitResult,
  resolveGitCwd,
  runGit,
  shellQuote,
} from "./git";

const MAX_BISECT_ROUNDS = 32;

const FORBIDDEN_ORACLE =
  /\bgit\s+push\b|\b--force\b|\bgit\s+reset\s+--hard\b|\brm\s+-[a-zA-Z]*r[a-zA-Z]*f\b/i;

function actionOf(args: Record<string, unknown>): string {
  const raw = args.action ?? args.op ?? args.operation;
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

function revOf(args: Record<string, unknown>): string {
  const raw = args.rev ?? args.revision ?? args.commit;
  return typeof raw === "string" ? raw.trim() : "";
}

function commandOf(args: Record<string, unknown>): string {
  const raw = args.command ?? args.oracle ?? args.verifyCommand;
  return typeof raw === "string" ? raw.trim() : "";
}

function parseRemaining(text: string): string | undefined {
  const remaining = text.match(
    /Bisecting:\s+(\d+)\s+revisions left to test after this(?:\s+\(roughly (\d+) steps\))?/i,
  );
  if (!remaining) {
    return undefined;
  }
  const steps = remaining[2] ? `, roughly ${remaining[2]} step(s)` : "";
  return `${remaining[1]} revision(s) left${steps}`;
}

function parseFirstBad(text: string): string | undefined {
  const hit = text.match(/^([0-9a-f]{7,40})\s+is the first bad commit/im);
  return hit?.[1];
}

function isDone(text: string): boolean {
  return /is the first bad commit/i.test(text) || /bisect complete/i.test(text);
}

function items(
  description: string,
  content: string,
): ContextItem[] {
  return [
    {
      name: "git bisect",
      description,
      content,
    },
  ];
}

async function resetBisect(extras: Parameters<ToolImpl>[1]): Promise<void> {
  await runGit(extras, ["bisect", "reset"]);
}

async function mark(
  extras: Parameters<ToolImpl>[1],
  verdict: "good" | "bad" | "skip",
  rev: string,
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  const args = rev ? ["bisect", verdict, shellQuote(rev)] : ["bisect", verdict];
  return runGit(extras, args);
}

function formatStep(
  title: string,
  result: { stdout: string; stderr: string; ok: boolean },
): string {
  const combined = `${result.stdout}\n${result.stderr}`;
  const firstBad = parseFirstBad(combined);
  const remaining = parseRemaining(combined);
  const notes = [
    firstBad ? `first_bad: ${firstBad}` : "",
    remaining ? `remaining: ${remaining}` : "",
    firstBad
      ? "Bisect finished. Run action=reset before other git work."
      : remaining
        ? "Checkout is at the next commit to test. Mark it good/bad, or action=run with an oracle command."
        : "",
  ].filter(Boolean);
  const body = formatGitResult(title, result);
  return notes.length ? `${body}\n\n${notes.join("\n")}` : body;
}

export const gitBisectImpl: ToolImpl = async (args, extras) => {
  const action = actionOf(args ?? {});
  if (!action) {
    throw new Error("Missing or invalid required parameter: action");
  }
  if (args.force === true || args.force === "true") {
    return items(
      "refused",
      "builtin_git_bisect never force-pushes or force-resets. Use action=reset to leave bisect (git bisect reset).",
    );
  }

  const abortReset = async () => {
    await resetBisect(extras);
  };

  if (extras.abortSignal?.aborted) {
    await abortReset();
    return items("reset on abort", "Aborted. Ran git bisect reset.");
  }

  if (action === "reset") {
    const result = await runGit(extras, ["bisect", "reset"]);
    return items(
      result.ok ? "reset" : "reset failed",
      formatGitResult("git bisect reset", result),
    );
  }

  if (action === "status") {
    const log = await runGit(extras, ["bisect", "log"]);
    const vis = await runGit(extras, ["bisect", "visualize", "--oneline"]);
    return items(
      log.ok ? "status" : "status failed",
      [formatGitResult("git bisect log", log), formatGitResult("git bisect visualize --oneline", vis)].join(
        "\n\n---\n\n",
      ),
    );
  }

  if (action === "start") {
    const bad = typeof args.bad === "string" ? args.bad.trim() : "";
    const good = typeof args.good === "string" ? args.good.trim() : "";
    const startArgs = ["bisect", "start"];
    if (bad) {
      startArgs.push(shellQuote(bad));
    }
    if (good) {
      startArgs.push(shellQuote(good));
    }
    const result = await runGit(extras, startArgs);
    if (!result.ok) {
      await resetBisect(extras);
    }
    return items(
      result.ok ? "started" : "start failed",
      formatStep(`git ${startArgs.join(" ")}`, result),
    );
  }

  if (action === "good" || action === "bad" || action === "skip") {
    const result = await mark(extras, action, revOf(args));
    return items(
      result.ok ? action : `${action} failed`,
      formatStep(`git bisect ${action}`, result),
    );
  }

  if (action === "run") {
    const command = commandOf(args);
    if (!command) {
      return items(
        "missing oracle",
        "action=run needs command (the oracle). Exit 0 = good, non-zero = bad. Example: command=\"grep -q GOOD STATUS\" or the workspace verifyCommand.",
      );
    }
    if (FORBIDDEN_ORACLE.test(command)) {
      return items(
        "refused",
        "Oracle command looks destructive (push/force/reset --hard/rm -rf). builtin_git_bisect will not run it.",
      );
    }
    const loop = args.loop !== false && args.loop !== "false";
    const maxRounds = Math.min(
      typeof args.max_rounds === "number" && args.max_rounds > 0
        ? Math.floor(args.max_rounds)
        : MAX_BISECT_ROUNDS,
      MAX_BISECT_ROUNDS,
    );
    const rounds = loop ? maxRounds : 1;
    const traces: string[] = [];

    try {
      for (let i = 0; i < rounds; i++) {
        if (extras.abortSignal?.aborted) {
          await abortReset();
          return items(
            "reset on abort",
            `${traces.join("\n\n")}\n\nAborted. Ran git bisect reset.`,
          );
        }
        const oracle = await extras.ide.subprocess(
          command,
          await resolveGitCwd(extras),
        ).then(
          (pair) => ({ stdout: pair[0] ?? "", stderr: pair[1] ?? "", ok: true }),
          (error) => ({
            stdout: "",
            stderr: typeof error === "string" ? error : (error as Error).message,
            ok: false,
          }),
        );
        const verdict = oracle.ok ? "good" : "bad";
        const marked = await mark(extras, verdict, "");
        const combined = `${marked.stdout}\n${marked.stderr}`;
        traces.push(
          [
            `round ${i + 1}: oracle ${verdict} (exit ${oracle.ok ? 0 : 1})`,
            oracle.stdout.trim() || oracle.stderr.trim()
              ? `oracle output:\n${(oracle.stdout || oracle.stderr).trim().slice(0, 800)}`
              : "",
            formatStep(`git bisect ${verdict}`, marked),
          ]
            .filter(Boolean)
            .join("\n"),
        );
        if (isDone(combined) || !marked.ok) {
          break;
        }
      }
    } catch (error) {
      await abortReset();
      const message = error instanceof Error ? error.message : String(error);
      return items(
        "reset on error",
        `${traces.join("\n\n")}\n\nOracle/bisect error: ${message}\nRan git bisect reset.`,
      );
    }

    const joined = traces.join("\n\n---\n\n");
    const firstBad = parseFirstBad(joined);
    return items(
      firstBad ? `first bad ${firstBad}` : "step",
      joined || "No bisect step ran.",
    );
  }

  return items(
    "unknown action",
    `Unknown action "${action}". Use start, good, bad, skip, run, status, or reset.`,
  );
};
