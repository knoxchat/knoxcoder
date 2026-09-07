import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const ptyStartTool: Tool = {
  type: "function",
  displayTitle: t("ptyStart"),
  wouldLikeTo: t("wouldLikeToPtyStart"),
  isCurrently: t("isStartingPty"),
  hasAlready: t("hasStartedPty"),
  readonly: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.PtyStart,
    description:
      "Start an interactive session (QEMU serial, gdb, kgdb, menuconfig, login prompts). Returns a job_id immediately. Write stdin with builtin_pty_send; read new output with builtin_pty_read (timeout is per-read, the process keeps running). Prefer this over builtin_run_terminal_command when the program needs stdin after start.",
    parameters: {
      type: "object",
      required: ["command"],
      properties: {
        command: {
          type: "string",
          description: "Command to run with stdin attached (e.g. qemu-system-x86_64 ..., gdb, cat).",
        },
        working_directory: {
          type: "string",
          description: "Optional cwd (absolute or workspace-relative).",
        },
      },
    },
  },
};

export const ptySendTool: Tool = {
  type: "function",
  displayTitle: t("ptySend"),
  wouldLikeTo: t("wouldLikeToPtySend"),
  isCurrently: t("isSendingPty"),
  hasAlready: t("hasSentPty"),
  readonly: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.PtySend,
    description:
      "Write to an interactive job started by builtin_pty_start. data is the exact bytes to send (include a trailing newline for line-oriented programs). \\x03 or ctrl_c=true sends Ctrl-C (SIGINT). \\x04 or eof=true closes stdin.",
    parameters: {
      type: "object",
      required: ["job_id"],
      properties: {
        job_id: {
          type: "string",
          description: "Job id from builtin_pty_start.",
        },
        data: {
          type: "string",
          description: "Bytes to write. Use \\n for newline, \\x03 for Ctrl-C.",
        },
        ctrl_c: {
          type: "boolean",
          description: "If true, send SIGINT (Ctrl-C) to the process group.",
        },
        eof: {
          type: "boolean",
          description: "If true, close stdin (EOF / Ctrl-D).",
        },
      },
    },
  },
};

export const ptyReadTool: Tool = {
  type: "function",
  displayTitle: t("ptyRead"),
  wouldLikeTo: t("wouldLikeToPtyRead"),
  isCurrently: t("isReadingPty"),
  hasAlready: t("hasReadPty"),
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.PtyRead,
    description:
      "Read new output from an interactive job since the last read (or since_byte). Waits up to timeout_ms for data; the process is not killed when the wait ends. kill=true SIGTERMs the job.",
    parameters: {
      type: "object",
      required: ["job_id"],
      properties: {
        job_id: {
          type: "string",
          description: "Job id from builtin_pty_start.",
        },
        timeout_ms: {
          type: "number",
          description: "How long to wait for new output (default 5000). 0 = return immediately.",
        },
        since_byte: {
          type: "number",
          description: "Byte offset into the job log. Omit to continue from the last builtin_pty_read.",
        },
        kill: {
          type: "boolean",
          description: "If true, stop the job (SIGTERM, then SIGKILL).",
        },
      },
    },
  },
};
