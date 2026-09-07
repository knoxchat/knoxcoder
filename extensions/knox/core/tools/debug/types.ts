/**
 * DAP-shaped requests for builtin_debug (HL-31).
 * VS Code maps these onto vscode.debug / DebugSession.customRequest.
 */

export const DEBUG_OPS = [
  "launch",
  "attach",
  "breakpoint",
  "continue",
  "step",
  "backtrace",
  "locals",
  "evaluate",
  "status",
  "disconnect",
] as const;

export type DebugControlOp = (typeof DEBUG_OPS)[number];

export type DebugStepKind = "over" | "into" | "out";

export interface DebugControlRequest {
  op: DebugControlOp;
  /** launch.json configuration name (launch/attach). */
  name?: string;
  program?: string;
  cwd?: string;
  args?: string[];
  /** gdbstub host:port or DAP target (attach), e.g. :1234 */
  target?: string;
  port?: number;
  filePath?: string;
  /** 1-based line for breakpoint. */
  line?: number;
  enabled?: boolean;
  threadId?: number;
  frameId?: number;
  expression?: string;
  step?: DebugStepKind;
}

export interface DebugStackFrame {
  id: number;
  name: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface DebugControlResult {
  ok: boolean;
  content: string;
  sessionActive?: boolean;
  frames?: DebugStackFrame[];
}

export function parseDebugOp(raw: unknown): DebugControlOp | "" {
  const value =
    typeof raw === "string"
      ? raw.trim().toLowerCase()
      : "";
  return (DEBUG_OPS as readonly string[]).includes(value)
    ? (value as DebugControlOp)
    : "";
}

export function formatBacktrace(frames: DebugStackFrame[]): string {
  if (!frames.length) {
    return "(empty backtrace)";
  }
  return frames
    .map((frame, index) => {
      const loc =
        frame.file && frame.line
          ? `${frame.file}:${frame.line}`
          : frame.file || "";
      const hash = `#${index}  ${frame.name}`;
      return loc ? `${hash} at ${loc}` : hash;
    })
    .join("\n");
}

export function formatLocals(locals: Record<string, string>): string {
  const keys = Object.keys(locals);
  if (!keys.length) {
    return "(no locals)";
  }
  return keys.map((key) => `${key} = ${locals[key]}`).join("\n");
}
