/**
 * Lite QEMU human-monitor parser (HL-32 follow-up).
 *
 * Not a full monitor protocol — extracts VM status, RIP/PC, and a handful
 * of registers from `info status` / `info registers` / `(qemu)` prompts
 * so compaction and builtin_qemu monitor= can keep the loop state.
 */

export interface ParsedQemuMonitor {
  prompt: boolean;
  vmStatus?: string;
  rip?: string;
  registers: string[];
  excerpt: string;
}

const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g;
const VM_STATUS_RE = /VM status:\s*([A-Za-z][\w-]*)/i;
const RIP_RE = /\b(?:RIP|PC)\s*=\s*(?:0x)?([0-9a-fA-F]+)/;
const REG_LINE_RE =
  /^\s*([A-Z]{2,3}X|[A-Z]{2,3}P|R[0-9]{1,2}|RIP|RSP|RBP|RAX|RBX|RCX|RDX|RSI|RDI|PC)\s*=\s*(?:0x)?([0-9a-fA-F]+)/i;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

export function parseQemuMonitor(text: string): ParsedQemuMonitor | null {
  const cleaned = stripAnsi(text);
  const prompt = /\(qemu\)/.test(cleaned);
  const vmStatus = cleaned.match(VM_STATUS_RE)?.[1];
  const ripMatch = cleaned.match(RIP_RE);
  const rip = ripMatch ? `0x${ripMatch[1].replace(/^0x/i, "")}` : undefined;
  const registers: string[] = [];
  for (const line of cleaned.split(/\r?\n/)) {
    const match = line.match(REG_LINE_RE);
    if (!match) {
      continue;
    }
    const name = match[1].toUpperCase();
    const value = `0x${match[2]}`;
    const item = `${name}=${value}`;
    if (!registers.includes(item) && registers.length < 16) {
      registers.push(item);
    }
  }
  if (!prompt && !vmStatus && !rip && registers.length === 0) {
    return null;
  }
  const excerpt = cleaned
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
    .slice(-12)
    .join("\n");
  return { prompt, vmStatus, rip, registers, excerpt };
}

export function formatQemuMonitor(input: string | ParsedQemuMonitor): string {
  const parsed = typeof input === "string" ? parseQemuMonitor(input) : input;
  if (!parsed) {
    return "";
  }
  const lines = ["QEMU monitor"];
  if (parsed.vmStatus) {
    lines.push(`VM status: ${parsed.vmStatus}`);
  }
  if (parsed.rip) {
    lines.push(`RIP: ${parsed.rip}`);
  }
  if (parsed.registers.length) {
    lines.push(`Registers: ${parsed.registers.slice(0, 8).join(" ")}`);
  }
  if (parsed.prompt) {
    lines.push("prompt: (qemu)");
  }
  return lines.join("\n");
}

export function looksLikeQemuMonitor(text: string): boolean {
  return parseQemuMonitor(text) !== null;
}
