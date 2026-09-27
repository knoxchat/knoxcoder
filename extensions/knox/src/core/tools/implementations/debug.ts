import { ToolImpl } from ".";
import {
  parseDebugOp,
  type DebugControlRequest,
} from "../debug/types";

function requestFromArgs(args: Record<string, unknown>): DebugControlRequest {
  const op = parseDebugOp(args.op ?? args.action ?? args.operation);
  const stepRaw = typeof args.step === "string" ? args.step.trim().toLowerCase() : "";
  const step =
    stepRaw === "into" || stepRaw === "out" || stepRaw === "over"
      ? stepRaw
      : undefined;
  return {
    op: op || "status",
    name: typeof args.name === "string" ? args.name.trim() : undefined,
    program: typeof args.program === "string" ? args.program.trim() : undefined,
    cwd:
      typeof args.cwd === "string"
        ? args.cwd.trim()
        : typeof args.working_directory === "string"
          ? args.working_directory.trim()
          : undefined,
    target: typeof args.target === "string" ? args.target.trim() : undefined,
    port: typeof args.port === "number" ? args.port : undefined,
    filePath:
      typeof args.filePath === "string"
        ? args.filePath.trim()
        : typeof args.filepath === "string"
          ? args.filepath.trim()
          : undefined,
    line: typeof args.line === "number" ? args.line : undefined,
    enabled: typeof args.enabled === "boolean" ? args.enabled : undefined,
    threadId: typeof args.threadId === "number" ? args.threadId : undefined,
    frameId: typeof args.frameId === "number" ? args.frameId : undefined,
    expression:
      typeof args.expression === "string" ? args.expression.trim() : undefined,
    step,
  };
}

export const debugImpl: ToolImpl = async (args, extras) => {
  const request = requestFromArgs(args ?? {});
  if (!parseDebugOp(request.op)) {
    return [
      {
        name: "Debug",
        description: "invalid op",
        content:
          "Missing or invalid op. Use launch, attach, breakpoint, continue, step, backtrace, locals, evaluate, status, or disconnect.",
      },
    ];
  }

  const control = extras.ide.debugControl;
  if (typeof control !== "function") {
    return [
      {
        name: "Debug",
        description: "no adapter",
        content:
          "No DAP backend. Start a VS Code debug session (Native Debug / CodeLLDB / gdb) or attach to QEMU gdbstub with builtin_debug op=attach target=:1234.",
      },
    ];
  }

  const result = await control(request);
  return [
    {
      name: "Debug",
      description: result.ok ? request.op : "error",
      content: result.content,
    },
  ];
};
