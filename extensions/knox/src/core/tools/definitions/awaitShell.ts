import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const awaitShellTool: Tool = {
  type: "function",
  displayTitle: t("awaitShell"),
  wouldLikeTo: t("wouldLikeToAwaitShell"),
  isCurrently: t("isAwaitingShell"),
  hasAlready: t("hasAwaitedShell"),
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.AwaitShell,
    description:
      "Poll, wait for, or kill a background shell job started by builtin_run_terminal_command or builtin_pty_start. Omit job_id to list jobs. timeout_ms=0 returns current output immediately; default waits up to 10 minutes. Jobs survive the parent LLM turn — keep awaiting until exit. Optional tail_lines, grep, since_byte, errors_only (parsed compiler/QEMU errors). Set kill=true to SIGTERM the job.",
    parameters: {
      type: "object",
      properties: {
        job_id: {
          type: "string",
          description:
            "Job id from a background / timed-out builtin_run_terminal_command result (e.g. sh_1_ab12cd).",
        },
        timeout_ms: {
          type: "number",
          description:
            "How long to wait for the job to exit (default 600000 = 10 min). 0 = poll current output without waiting. Repeat until Status: exited, or abort.",
        },
        kill: {
          type: "boolean",
          description: "If true, stop the job (SIGTERM, then SIGKILL).",
        },
        tail_lines: {
          type: "number",
          description: "Return only the last N lines of the job log.",
        },
        grep: {
          type: "string",
          description: "Filter log lines matching this regex (e.g. error:).",
        },
        since_byte: {
          type: "number",
          description: "Return log bytes after this offset (from Full log / Next byte).",
        },
        errors_only: {
          type: "boolean",
          description: "Return parsed compiler/linker/QEMU errors plus a short tail.",
        },
      },
    },
  },
};
