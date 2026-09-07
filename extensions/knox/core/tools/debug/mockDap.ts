/**
 * In-process mock DAP for tests (HL-31).
 * breakpoint → continue → backtrace, without VS Code.
 */

import {
  formatBacktrace,
  formatLocals,
  type DebugControlRequest,
  type DebugControlResult,
  type DebugStackFrame,
} from "./types";

const DEFAULT_FRAMES: DebugStackFrame[] = [
  { id: 1, name: "copy_to_user", file: "mm/filemap.c", line: 42, column: 0 },
  { id: 2, name: "sys_read", file: "fs/read_write.c", line: 10, column: 0 },
];

const DEFAULT_LOCALS: Record<string, string> = {
  to: "0xffff888012345000",
  from: "0xffff888012346000",
  n: "16",
};

export class MockDapSession {
  sessionActive = false;
  stopped = false;
  breakpoints: Array<{ filePath: string; line: number }> = [];
  frames: DebugStackFrame[];
  locals: Record<string, string>;
  lastEvaluate?: string;

  constructor(opts?: {
    frames?: DebugStackFrame[];
    locals?: Record<string, string>;
  }) {
    this.frames = opts?.frames ?? DEFAULT_FRAMES;
    this.locals = opts?.locals ?? { ...DEFAULT_LOCALS };
  }

  async handle(request: DebugControlRequest): Promise<DebugControlResult> {
    switch (request.op) {
      case "launch":
      case "attach":
        this.sessionActive = true;
        this.stopped = false;
        return {
          ok: true,
          content:
            request.op === "attach"
              ? `Attached${request.target ? ` to ${request.target}` : request.port ? ` to :${request.port}` : ""}.`
              : `Launched${request.program ? ` ${request.program}` : ""}.`,
          sessionActive: true,
        };
      case "breakpoint": {
        const filePath = request.filePath?.trim();
        const line = request.line;
        if (!filePath || typeof line !== "number" || line < 1) {
          return {
            ok: false,
            content: "breakpoint needs filePath and a 1-based line.",
            sessionActive: this.sessionActive,
          };
        }
        if (request.enabled === false) {
          this.breakpoints = this.breakpoints.filter(
            (bp) => !(bp.filePath === filePath && bp.line === line),
          );
          return {
            ok: true,
            content: `Removed breakpoint ${filePath}:${line}`,
            sessionActive: this.sessionActive,
          };
        }
        this.breakpoints.push({ filePath, line });
        return {
          ok: true,
          content: `Breakpoint ${filePath}:${line}`,
          sessionActive: this.sessionActive,
        };
      }
      case "continue":
        if (!this.sessionActive) {
          return { ok: false, content: "No debug session.", sessionActive: false };
        }
        if (this.breakpoints.length > 0) {
          this.stopped = true;
          const hit = this.breakpoints[0];
          return {
            ok: true,
            content: `stopped at ${hit.filePath}:${hit.line} (breakpoint)`,
            sessionActive: true,
            frames: this.frames,
          };
        }
        this.stopped = false;
        this.sessionActive = false;
        return { ok: true, content: "exited (no breakpoint)", sessionActive: false };
      case "step":
        if (!this.sessionActive) {
          return { ok: false, content: "No debug session.", sessionActive: false };
        }
        this.stopped = true;
        return {
          ok: true,
          content: `stopped after step ${request.step ?? "over"}`,
          sessionActive: true,
          frames: this.frames,
        };
      case "backtrace":
        if (!this.sessionActive) {
          return { ok: false, content: "No debug session.", sessionActive: false };
        }
        if (!this.stopped) {
          return {
            ok: false,
            content: "Not stopped. continue/step until a breakpoint, then backtrace.",
            sessionActive: true,
          };
        }
        return {
          ok: true,
          content: formatBacktrace(this.frames),
          sessionActive: true,
          frames: this.frames,
        };
      case "locals":
        if (!this.sessionActive || !this.stopped) {
          return {
            ok: false,
            content: "Locals require a stopped session.",
            sessionActive: this.sessionActive,
          };
        }
        return {
          ok: true,
          content: formatLocals(this.locals),
          sessionActive: true,
        };
      case "evaluate": {
        const expression = request.expression?.trim();
        if (!expression) {
          return { ok: false, content: "evaluate needs expression." };
        }
        this.lastEvaluate = expression;
        const known = this.locals[expression];
        return {
          ok: true,
          content: known ?? `<unavailable ${expression}>`,
          sessionActive: this.sessionActive,
        };
      }
      case "status":
        return {
          ok: true,
          content: this.sessionActive
            ? `session active; stopped=${this.stopped}; breakpoints=${this.breakpoints.length}`
            : "no debug session",
          sessionActive: this.sessionActive,
        };
      case "disconnect":
        this.sessionActive = false;
        this.stopped = false;
        return { ok: true, content: "disconnected", sessionActive: false };
      default:
        return { ok: false, content: `Unknown debug op: ${request.op}` };
    }
  }
}
