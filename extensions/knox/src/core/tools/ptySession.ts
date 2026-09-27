/**
 * Interactive PTY-style sessions (HL-13).
 *
 * Prefers native node-pty when available; otherwise piped stdin.
 * Timeout is per-read.
 * Send \\x03 / ^C as SIGINT; \\x04 / ^D closes stdin (EOF).
 */
import {
  closeShellJobStdin,
  getShellJob,
  getShellJobReadCursor,
  jobOutputSince,
  setShellJobReadCursor,
  signalShellJob,
  startShellJob,
  type ShellJobSnapshot,
  waitForShellOutput,
  writeShellJobStdin,
} from "./shellJobs";

export interface PtySendResult {
  ok: boolean;
  sigint: boolean;
  eof: boolean;
  written: boolean;
}

export function unescapePtyData(raw: string): string {
  return raw
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\e/g, "\x1b")
    .replace(/\\\\/g, "\\");
}

export function decodePtyPayload(
  raw: unknown,
  extras: { eof?: unknown; ctrl_c?: unknown } = {},
): { write: string; sigint: boolean; eof: boolean } {
  const text = typeof raw === "string" ? unescapePtyData(raw) : "";
  const whole = text.trim().toLowerCase();
  const ctrlCArg = extras.ctrl_c === true || extras.ctrl_c === "true";
  const eofArg = extras.eof === true || extras.eof === "true";
  const sigint =
    ctrlCArg ||
    whole === "^c" ||
    whole === "ctrl-c" ||
    whole === "ctrl+c" ||
    text.includes("\x03");
  const eof = eofArg || whole === "^d" || text.includes("\x04");
  const write = text.replace(/\x03/g, "").replace(/\x04/g, "");
  return { write, sigint, eof };
}

export function startPtyJob(opts: {
  command: string;
  cwd: string;
}): string {
  return startShellJob({
    command: opts.command,
    displayCommand: opts.command,
    cwd: opts.cwd,
    stdin: true,
    nativePty: true,
    idPrefix: "pty",
  });
}

export function sendPty(id: string, raw: unknown, extras: {
  eof?: unknown;
  ctrl_c?: unknown;
} = {}): PtySendResult {
  const decoded = decodePtyPayload(raw, extras);
  if (!getShellJob(id)) {
    return { ok: false, sigint: decoded.sigint, eof: decoded.eof, written: false };
  }
  let written = false;
  if (decoded.write) {
    written = writeShellJobStdin(id, decoded.write);
  }
  if (decoded.sigint) {
    signalShellJob(id, "SIGINT");
  }
  if (decoded.eof) {
    closeShellJobStdin(id);
  }
  return { ok: true, sigint: decoded.sigint, eof: decoded.eof, written };
}

export async function readPty(
  id: string,
  opts: {
    timeoutMs?: number;
    sinceByte?: number;
    abortSignal?: AbortSignal;
  } = {},
): Promise<{ snapshot: ShellJobSnapshot; body: string; nextByte: number }> {
  const since =
    opts.sinceByte !== undefined
      ? opts.sinceByte
      : getShellJobReadCursor(id);
  const snapshot = await waitForShellOutput(id, {
    sinceByte: since,
    timeoutMs: opts.timeoutMs,
    abortSignal: opts.abortSignal,
  });
  const body = jobOutputSince(snapshot, since);
  const nextByte = snapshot.outputBytes ?? 0;
  setShellJobReadCursor(id, nextByte);
  return { snapshot, body, nextByte };
}
