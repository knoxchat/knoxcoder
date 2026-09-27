import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const runTerminalCommandTool: Tool = {
  type: "function",
  displayTitle: t("runTerminalCommand"),
  wouldLikeTo: t("wouldLikeToRunCommand"),
  isCurrently: t("isRunningCommand"),
  hasAlready: t("hasRunCommand"),
  readonly: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.RunTerminalCommand,
    description:
      "Run a terminal command. The workspace shell remembers cwd across calls (cd persists). Prefer builtin_edit_file / builtin_write_file / builtin_apply_patch for file edits — do not write files with cat/echo/heredoc. Do not perform operations that require administrator permissions. Return the command's full output — do not pipe to grep/head to filter errors (grep exits 1 when there are no matches and looks like a failed job). make/ninja/gcc/qemu/cargo check|build|test|clippy logs are compacted to parsed errors + last 80 lines; the full log path is in the result. make/ninja/cmake --build/meson compile/./configure/qemu-system-*/cargo check|build|test|clippy|nextest|bench|doc|miri start in the background immediately — poll with builtin_await_shell (default wait 10 min per call). Do not background cargo metadata, cargo tree, or cargo fmt --check. Other long tests/servers: set background=true, or wait — after ~30s the command is backgrounded and you get a job_id. Interactive programs (QEMU monitor, gdb, menuconfig): use builtin_pty_start / builtin_pty_send / builtin_pty_read.",
    parameters: {
      type: "object",
      required: ["command"],
      properties: {
        command: {
          type: "string",
          description: "The command to run in the persistent workspace shell.",
        },
        working_directory: {
          type: "string",
          description:
            "Optional cwd for this command (absolute or workspace-relative). Updates the session cwd.",
        },
        background: {
          type: "boolean",
          description:
            "If true, start the command and return a job_id immediately (servers, watchers, long tests).",
        },
        block_until_ms: {
          type: "number",
          description:
            "Wait this many ms for the command to exit before backgrounding (default 30000). 0 waits until the hard cap (~110s) then backgrounds.",
        },
      },
    },
  },
};
