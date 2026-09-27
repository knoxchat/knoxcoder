/**
 * Last N lines of QEMU / PTY / serial job logs (HL-45).
 *
 * Pure string formatting so the GUI can inject serial context without
 * bundling Node `shellJobs` / `node-pty`.
 */

import { formatOops, parseOops } from "../tools/build/parseOops";

export const SERIAL_CONTEXT_MARKER = "Serial / dmesg";
export const SERIAL_TAIL_LINES = 80;

/** Job fields needed to format a serial/dmesg tail (subset of ShellJobSnapshot). */
export interface SerialJobView {
  id: string;
  command: string;
  status: string;
  stdin?: boolean;
  stdout?: string;
  stderr?: string;
  logPath?: string;
}

const SERIAL_COMMAND_RE =
  /qemu-system-[\w-]+|builtin_qemu|\bpty\b|-serial\b|dmesg|kgdb|gdbstub/i;

let injectedSerial = "";

export function setSerialContextInject(text: string): void {
  injectedSerial = text.trim();
}

export function formatSerialContextInject(): string {
  return injectedSerial;
}

export function resetSerialContextForTests(): void {
  injectedSerial = "";
}

export function isSerialJob(job: Pick<SerialJobView, "command" | "stdin">): boolean {
  return Boolean(job.stdin) || SERIAL_COMMAND_RE.test(job.command);
}

export function tailLines(text: string, maxLines = SERIAL_TAIL_LINES): string {
  const lines = text.replace(/\s+$/, "").split(/\r?\n/);
  if (lines.length <= maxLines) {
    return lines.join("\n");
  }
  return lines.slice(-maxLines).join("\n");
}

export function formatSerialContext(
  jobs: SerialJobView[],
  maxLines = SERIAL_TAIL_LINES,
): string {
  const serialJobs = jobs.filter(isSerialJob).slice(0, 4);
  if (!serialJobs.length) {
    return "";
  }
  const blocks: string[] = [`## ${SERIAL_CONTEXT_MARKER}`];
  for (const job of serialJobs) {
    const raw = [job.stdout, job.stderr].filter(Boolean).join("\n");
    const oops = parseOops(raw);
    const tail = tailLines(raw, maxLines);
    blocks.push(
      `### Job ${job.id} (${job.status})`,
      job.command,
      job.logPath ? `Full log: ${job.logPath}` : "",
      oops ? formatOops(oops) : "",
      tail || "(empty)",
    );
  }
  return blocks.filter((line, i, arr) => line !== "" || arr[i - 1] !== "").join("\n");
}

export function loadSerialContextFromJobs(
  jobs: SerialJobView[],
  maxLines = SERIAL_TAIL_LINES,
): string {
  return formatSerialContext(jobs, maxLines);
}
