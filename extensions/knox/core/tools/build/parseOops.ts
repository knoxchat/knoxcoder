/**
 * Parse Linux oops / panic / sanitizer / QEMU guest-fault logs (HL-44).
 *
 * Used by compaction, soul oracles, and compacted qemu/serial job output
 * so the model sees RIP + call-trace frames instead of a raw dmesg dump.
 */

export type OopsKind =
  | "oops"
  | "panic"
  | "kasan"
  | "ubsan"
  | "asan"
  | "qemu_fault";

export interface OopsFrame {
  symbol?: string;
  offset?: string;
  size?: string;
  file?: string;
  line?: number;
  unreliable?: boolean;
  raw: string;
}

export interface ParsedOops {
  kind: OopsKind;
  title: string;
  rip?: string;
  ripSymbol?: string;
  tainted?: string;
  frames: OopsFrame[];
  rawExcerpt: string;
}

const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g;

const PANIC_RE = /Kernel panic(?:\s*-\s*not syncing)?\s*:?\s*(.*)$/im;
const OOPS_RE = /^Oops:\s*(.*)$/im;
const KASAN_RE = /BUG:\s*KASAN:\s*(.+)$/im;
const UBSAN_RE = /UBSAN:\s*(.+)$/im;
const ASAN_RE = /ERROR:\s*AddressSanitizer:\s*(.+)$/im;
const QEMU_FAULT_RE =
  /(?:qemu(?:-system-[\w-]+)?:\s*(?:fatal:|warning:)?\s*)?(?:Trying to execute code outside RAM|guest fault|Guest crashed|qemu: fatal:)/i;

const RIP_RE =
  /RIP:\s*(?:[0-9a-fA-F]+:)?(?:\[<\s*[0-9a-fA-F]+\s*>\])?\s*([A-Za-z_?][\w.]*\+0x[0-9a-fA-F]+\/0x[0-9a-fA-F]+|[A-Za-z_?][\w.]*(?:\+0x[0-9a-fA-F]+)?)/;
const RIP_BARE_RE =
  /RIP:\s*(?:[0-9a-fA-F]+:)?(?:\[<\s*[0-9a-fA-F]+\s*>\])?\s*(\S+)/;

const TAINTED_RE = /\b(?:Not tainted|Tainted:\s*[A-Z ]+)/i;

const FRAME_RE =
  /^\s*(?:\?\s*)?(?:\[\s*<[0-9a-fA-F]+>\s*\]\s*)?(?:#\d+\s+0x[0-9a-fA-F]+\s+in\s+)?([A-Za-z_?][\w.]*)(?:\+0x([0-9a-fA-F]+)\/0x([0-9a-fA-F]+))?(?:\s+(\S+\.[A-Za-z0-9_+-]+):(\d+))?/;

const ASAN_FRAME_RE =
  /^\s*#\d+\s+0x[0-9a-fA-F]+\s+in\s+([A-Za-z_?][\w:]*)\s+(\S+):(\d+)/;

const CALL_TRACE_START = /^\s*Call Trace:\s*$/i;
const CALL_TRACE_END =
  /^\s*(?:Modules linked in:|Code:|RSP:|RAX:|CR2:|---\[|Kernel Offset:|CPU:|Hardware name:|Kernel panic|Oops:)/i;

const SKIP_FRAME_SYMBOLS = new Set([
  "Kernel",
  "CPU",
  "RIP",
  "Oops",
  "Modules",
  "Hardware",
  "Code",
  "Call",
  "BUG",
  "UBSAN",
  "ERROR",
]);

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function classifyKind(text: string): { kind: OopsKind; title: string } | undefined {
  const kasan = text.match(KASAN_RE);
  if (kasan) {
    return { kind: "kasan", title: `BUG: KASAN: ${kasan[1].trim()}` };
  }
  const ubsan = text.match(UBSAN_RE);
  if (ubsan) {
    return { kind: "ubsan", title: `UBSAN: ${ubsan[1].trim()}` };
  }
  const asan = text.match(ASAN_RE);
  if (asan) {
    return { kind: "asan", title: `AddressSanitizer: ${asan[1].trim()}` };
  }
  const panic = text.match(PANIC_RE);
  if (panic) {
    const rest = (panic[1] ?? "").trim();
    return {
      kind: "panic",
      title: rest
        ? `Kernel panic - not syncing: ${rest}`
        : "Kernel panic - not syncing",
    };
  }
  if (QEMU_FAULT_RE.test(text)) {
    const line =
      text
        .split(/\r?\n/)
        .find((item) => QEMU_FAULT_RE.test(item))
        ?.trim() ?? "QEMU guest fault";
    return { kind: "qemu_fault", title: line };
  }
  const oops = text.match(OOPS_RE);
  if (oops || /\bOops:\s/i.test(text)) {
    return { kind: "oops", title: oops ? `Oops: ${oops[1].trim()}` : "Oops" };
  }
  return undefined;
}

function parseRip(text: string): { rip?: string; ripSymbol?: string } {
  const hit = text.match(RIP_RE) ?? text.match(RIP_BARE_RE);
  if (!hit) {
    return {};
  }
  const rip = hit[1]?.trim();
  if (!rip) {
    return {};
  }
  const symbol = rip.replace(/^\?\s*/, "").split("+")[0];
  return { rip, ripSymbol: symbol || rip };
}

function parseTainted(text: string): string | undefined {
  const hit = text.match(TAINTED_RE);
  return hit?.[0]?.trim();
}

function parseFrame(line: string): OopsFrame | undefined {
  const trimmed = line.replace(/^\s*\[<.*>\]\s*/, "").trim();
  if (!trimmed || CALL_TRACE_START.test(trimmed) || CALL_TRACE_END.test(trimmed)) {
    return undefined;
  }
  if (/^<.*>$/.test(trimmed)) {
    return undefined;
  }

  const asan = trimmed.match(ASAN_FRAME_RE);
  if (asan) {
    return {
      symbol: asan[1],
      file: asan[2],
      line: Number.parseInt(asan[3], 10),
      raw: trimmed,
    };
  }

  const unreliable = /^\?/.test(trimmed);
  const frame = trimmed.match(FRAME_RE);
  if (!frame) {
    return undefined;
  }
  const symbol = frame[1];
  if (!symbol || SKIP_FRAME_SYMBOLS.has(symbol)) {
    return undefined;
  }
  return {
    symbol,
    offset: frame[2],
    size: frame[3],
    file: frame[4],
    line: frame[5] ? Number.parseInt(frame[5], 10) : undefined,
    unreliable,
    raw: trimmed,
  };
}

function parseCallTrace(lines: string[]): OopsFrame[] {
  const frames: OopsFrame[] = [];
  let inTrace = false;
  for (const line of lines) {
    if (CALL_TRACE_START.test(line)) {
      inTrace = true;
      continue;
    }
    if (!inTrace) {
      continue;
    }
    if (CALL_TRACE_END.test(line) && !FRAME_RE.test(line.trim())) {
      break;
    }
    if (!line.trim()) {
      if (frames.length) {
        break;
      }
      continue;
    }
    const frame = parseFrame(line);
    if (frame) {
      frames.push(frame);
      continue;
    }
    if (frames.length && !/^[<\[]/.test(line.trim())) {
      break;
    }
  }

  if (frames.length === 0) {
    for (const line of lines) {
      const asan = line.match(ASAN_FRAME_RE);
      if (asan) {
        frames.push({
          symbol: asan[1],
          file: asan[2],
          line: Number.parseInt(asan[3], 10),
          raw: line.trim(),
        });
      }
    }
  }
  return frames.slice(0, 24);
}

function excerpt(lines: string[], cap = 40): string {
  const start = lines.findIndex((line) =>
    /RIP:|Call Trace:|Kernel panic|Oops:|KASAN|UBSAN|AddressSanitizer|guest fault|qemu: fatal/i.test(
      line,
    ),
  );
  const from = start >= 0 ? start : 0;
  return lines.slice(from, from + cap).join("\n");
}

export function looksLikeOops(text: string): boolean {
  if (!text) {
    return false;
  }
  return classifyKind(stripAnsi(text)) !== undefined;
}

export function parseOops(text: string): ParsedOops | undefined {
  if (!text) {
    return undefined;
  }
  const cleaned = stripAnsi(text);
  const classified = classifyKind(cleaned);
  if (!classified) {
    return undefined;
  }
  const lines = cleaned.split(/\r?\n/);
  const { rip, ripSymbol } = parseRip(cleaned);
  const frames = parseCallTrace(lines);

  if (rip && !frames.some((frame) => frame.symbol === ripSymbol)) {
    const fromRip = parseFrame(rip);
    if (fromRip) {
      frames.unshift(fromRip);
    } else {
      frames.unshift({ symbol: ripSymbol, raw: rip });
    }
  }

  return {
    kind: classified.kind,
    title: classified.title.slice(0, 240),
    rip,
    ripSymbol,
    tainted: parseTainted(cleaned),
    frames,
    rawExcerpt: excerpt(lines),
  };
}

export function formatOopsFrame(frame: OopsFrame): string {
  const mark = frame.unreliable ? "? " : "  ";
  const loc =
    frame.file && frame.line
      ? ` ${frame.file}:${frame.line}`
      : frame.file
        ? ` ${frame.file}`
        : "";
  const off =
    frame.offset && frame.size
      ? `+0x${frame.offset}/0x${frame.size}`
      : "";
  const symbol = frame.symbol ? `${frame.symbol}${off}` : frame.raw;
  return `${mark}${symbol}${loc}`.trimEnd();
}

export function formatOops(input: string | ParsedOops): string {
  const parsed = typeof input === "string" ? parseOops(input) : input;
  if (!parsed) {
    return "";
  }
  const lines = [
    `Oops: ${parsed.kind}`,
    `Title: ${parsed.title}`,
  ];
  if (parsed.rip) {
    lines.push(`RIP: ${parsed.rip}`);
  }
  if (parsed.tainted) {
    lines.push(`Tainted: ${parsed.tainted}`);
  }
  if (parsed.frames.length) {
    lines.push("Call trace:");
    for (const frame of parsed.frames.slice(0, 16)) {
      lines.push(formatOopsFrame(frame));
    }
  }
  return lines.join("\n");
}
