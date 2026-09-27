import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";
import { DEBUG_OPS } from "../debug/types";

export const debugTool: Tool = {
  type: "function",
  displayTitle: t("debug"),
  wouldLikeTo: t("wouldLikeToDebug"),
  isCurrently: t("isDebugging"),
  hasAlready: t("hasDebugged"),
  readonly: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.Debug,
    description: `Control a DAP debug session (gdb / CodeLLDB / Native Debug via VS Code).

Ops:
- launch: start using launch.json name= or program=
- attach: attach (QEMU gdbstub: target=":1234" or port=1234)
- breakpoint: set/clear a source breakpoint (filePath + 1-based line)
- continue / step (over|into|out)
- backtrace / locals / evaluate
- status / disconnect

Requires an IDE debug adapter. Prefer this over inventing gdb commands when a session exists. Catalog is gated: systems profile or an active debug session (not listed for ordinary app chats).`,
    parameters: {
      type: "object",
      required: ["op"],
      properties: {
        op: {
          type: "string",
          enum: [...DEBUG_OPS],
          description: "DAP operation",
        },
        name: {
          type: "string",
          description: "launch.json configuration name for launch/attach",
        },
        program: {
          type: "string",
          description: "Program path for launch when name is omitted",
        },
        cwd: {
          type: "string",
          description: "Working directory for launch",
        },
        target: {
          type: "string",
          description: "Attach target (e.g. :1234 for QEMU -s)",
        },
        port: {
          type: "number",
          description: "gdbstub TCP port (default 1234)",
        },
        filePath: {
          type: "string",
          description: "Source file for breakpoint",
        },
        line: {
          type: "number",
          description: "1-based line for breakpoint",
        },
        enabled: {
          type: "boolean",
          description: "false removes the breakpoint",
        },
        threadId: {
          type: "number",
          description: "Thread id (default 1)",
        },
        frameId: {
          type: "number",
          description: "Stack frame id for evaluate/locals",
        },
        expression: {
          type: "string",
          description: "Expression for evaluate",
        },
        step: {
          type: "string",
          enum: ["over", "into", "out"],
          description: "Step kind (default over)",
        },
      },
    },
  },
};
