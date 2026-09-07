import { ChatMessage, ToolCallDelta } from "../index.js";
import { resolveBuiltInToolName } from "../tools/builtIn.js";

export interface ExtractedTextToolCalls {
  content: string;
  toolCalls: ToolCallDelta[];
  /** Incomplete markup still waiting for a closing tag. */
  rest: string;
}

interface ParsedTag {
  raw: string;
  name: string;
  closing: boolean;
  attrs: Record<string, string>;
  start: number;
  end: number;
}

/**
 * DSML delimiters: ASCII `|` or DeepSeek/Cursor fullwidth `｜` (U+FF5C).
 * Models trained on Cursor-style tool markup emit `<｜DSML｜tool_calls>`,
 * which the previous ASCII-only regex treated as plain text — the agent
 * printed the tags and stopped instead of executing the call.
 */
const DSML_BAR_RE = "[|\\uFF5C]";
const DSML_TAG_RE = new RegExp(
  `<\\s*(/?)\\s*${DSML_BAR_RE}\\s*DSML\\s*${DSML_BAR_RE}\\s*([A-Za-z_][\\w]*)\\b([^>]*)>`,
  "gi",
);
const XML_TAG_RE =
  /<\s*(\/?)\s*(function_calls|tool_calls|tool_call|function_call|invoke|parameter)\b([^>]*)>/gi;
const HERMES_FN_RE = /<\s*(\/?)\s*function(?:\s*=\s*([^\s>]+))?([^>]*)>/gi;
const HERMES_PARAM_RE = /<\s*(\/?)\s*parameter\s*=\s*([^\s>]+)([^>]*)>/gi;

const TOOL_BLOCK_NAMES = new Set([
  "tool_calls",
  "tool_call",
  "function_calls",
  "function_call",
  "invoke",
  "function",
]);

const START_TOKEN_CANDIDATES = [
  "<|DSML|",
  "<|DSML|tool_calls>",
  "< | DSML |",
  "< | DSML | tool_calls>",
  "<tool_call",
  "<tool_calls",
  "<function_calls",
  "<function_call",
  "<invoke",
  "<function=",
  "<function ",
];

function normalizeDsmlBars(text: string): string {
  return text.replace(/\uFF5C/g, "|");
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re =
    /([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function nextMatch(
  re: RegExp,
  text: string,
  from: number,
): RegExpExecArray | null {
  re.lastIndex = from;
  const match = re.exec(text);
  return match && match.index >= from ? match : null;
}

function applyEqName(tag: ParsedTag): ParsedTag {
  if (tag.attrs.name) {
    return tag;
  }
  const eq = tag.raw.match(
    /(?:parameter|function|invoke)\s*=\s*([^\s>/]+)/i,
  );
  if (eq) {
    tag.attrs.name = eq[1].replace(/['"]/g, "");
  }
  return tag;
}

function nextTag(text: string, from: number): ParsedTag | null {
  const candidates: ParsedTag[] = [];

  const dsml = nextMatch(DSML_TAG_RE, text, from);
  if (dsml) {
    candidates.push({
      raw: dsml[0],
      name: dsml[2].toLowerCase(),
      closing: dsml[1] === "/",
      attrs: parseAttrs(dsml[3] ?? ""),
      start: dsml.index,
      end: dsml.index + dsml[0].length,
    });
  }

  const xml = nextMatch(XML_TAG_RE, text, from);
  if (xml) {
    candidates.push(
      applyEqName({
        raw: xml[0],
        name: xml[2].toLowerCase(),
        closing: xml[1] === "/",
        attrs: parseAttrs(xml[3] ?? ""),
        start: xml.index,
        end: xml.index + xml[0].length,
      }),
    );
  }

  const hermesFn = nextMatch(HERMES_FN_RE, text, from);
  if (hermesFn) {
    const nameFromEq = (hermesFn[2] ?? "").replace(/['"]/g, "");
    candidates.push({
      raw: hermesFn[0],
      name: "function",
      closing: hermesFn[1] === "/",
      attrs: {
        ...parseAttrs(hermesFn[3] ?? ""),
        ...(nameFromEq ? { name: nameFromEq } : {}),
      },
      start: hermesFn.index,
      end: hermesFn.index + hermesFn[0].length,
    });
  }

  const hermesParam = nextMatch(HERMES_PARAM_RE, text, from);
  if (hermesParam) {
    candidates.push({
      raw: hermesParam[0],
      name: "parameter",
      closing: hermesParam[1] === "/",
      attrs: {
        ...parseAttrs(hermesParam[3] ?? ""),
        name: hermesParam[2].replace(/['"]/g, ""),
      },
      start: hermesParam.index,
      end: hermesParam.index + hermesParam[0].length,
    });
  }

  if (!candidates.length) {
    return null;
  }
  candidates.sort((a, b) => a.start - b.start || a.end - b.end);
  return candidates[0] ?? null;
}

function coerceParamValue(
  raw: string,
  attrs: Record<string, string>,
): unknown {
  if (attrs.string === "true") {
    return raw;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return raw;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    if (trimmed === "true") {
      return true;
    }
    if (trimmed === "false") {
      return false;
    }
    if (/^-?\d+$/.test(trimmed)) {
      return Number(trimmed);
    }
    if (/^-?\d+\.\d+$/.test(trimmed)) {
      return Number(trimmed);
    }
    return raw;
  }
}

function resolveName(name: string): string {
  return resolveBuiltInToolName(name) || name.trim();
}

let textCallSeq = 0;

function nextToolCallId(name: string, index: number): string {
  textCallSeq += 1;
  const safe = name.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 32) || "tool";
  return `call_text_${textCallSeq}_${index}_${safe}`;
}

function argsToJson(args: Record<string, unknown>): string {
  return JSON.stringify(args);
}

function parseJsonToolPayload(inner: string): ToolCallDelta[] {
  const trimmed = inner.trim();
  if (!trimmed) {
    return [];
  }

  const tryObjects: unknown[] = [];
  try {
    tryObjects.push(JSON.parse(trimmed));
  } catch {
    const nameLine = trimmed.match(/^([A-Za-z_][\w]*)\s*\n([\s\S]+)$/);
    if (nameLine) {
      try {
        tryObjects.push({
          name: nameLine[1],
          arguments: JSON.parse(nameLine[2]),
        });
      } catch {
        return [];
      }
    } else {
      return [];
    }
  }

  const calls: ToolCallDelta[] = [];
  for (const value of tryObjects) {
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const rec = item as Record<string, unknown>;
      const name = String(
        rec.name ?? rec.tool ?? (rec.function as any)?.name ?? "",
      ).trim();
      if (!name) {
        continue;
      }
      let args = rec.arguments ?? rec.parameters ?? rec.args ?? rec.input;
      if (args === undefined && rec.function && typeof rec.function === "object") {
        args = (rec.function as Record<string, unknown>).arguments;
      }
      const resolved = resolveName(name);
      calls.push({
        id: nextToolCallId(resolved, calls.length),
        type: "function",
        index: calls.length,
        function: {
          name: resolved,
          arguments:
            typeof args === "string" ? args : argsToJson((args as any) ?? {}),
        },
      });
    }
  }
  return calls;
}

function parseParameterBody(
  text: string,
  from: number,
  to: number,
): { args: Record<string, unknown>; end: number } {
  const args: Record<string, unknown> = {};
  let cursor = from;
  while (cursor < to) {
    const tag = nextTag(text, cursor);
    if (!tag || tag.start >= to) {
      break;
    }
    if (tag.name !== "parameter" || tag.closing) {
      cursor = tag.end;
      continue;
    }
    const close = findMatchingClose(text, tag);
    const valueEnd = close ? close.start : to;
    const raw = text.slice(tag.end, valueEnd);
    const key = tag.attrs.name || tag.attrs.key;
    if (key) {
      args[key] = coerceParamValue(raw, tag.attrs);
    }
    cursor = close ? close.end : valueEnd;
  }
  return { args, end: cursor };
}

function findMatchingClose(text: string, open: ParsedTag): ParsedTag | null {
  let depth = 1;
  let cursor = open.end;
  while (cursor < text.length) {
    const tag = nextTag(text, cursor);
    if (!tag) {
      return null;
    }
    if (tag.name === open.name) {
      if (tag.closing) {
        depth -= 1;
        if (depth === 0) {
          return tag;
        }
      } else {
        depth += 1;
      }
    }
    cursor = tag.end;
  }
  return null;
}

function parseInvokeOrFunction(
  text: string,
  open: ParsedTag,
  close: ParsedTag | null,
  index: number,
): ToolCallDelta | null {
  const name = (open.attrs.name || open.attrs.tool || "").trim();
  if (!name) {
    return null;
  }
  const bodyEnd = close ? close.start : text.length;
  const { args } = parseParameterBody(text, open.end, bodyEnd);
  const resolved = resolveName(name);
  return {
    id: nextToolCallId(resolved, index),
    type: "function",
    index,
    function: {
      name: resolved,
      arguments: argsToJson(args),
    },
  };
}

function parseToolRegion(
  text: string,
  open: ParsedTag,
  close: ParsedTag | null,
): ToolCallDelta[] {
  const bodyEnd = close ? close.start : text.length;
  const inner = text.slice(open.end, bodyEnd);

  if (open.name === "invoke" || open.name === "function") {
    const call = parseInvokeOrFunction(text, open, close, 0);
    return call ? [call] : [];
  }

  const calls: ToolCallDelta[] = [];
  let cursor = open.end;
  while (cursor < bodyEnd) {
    const tag = nextTag(text, cursor);
    if (!tag || tag.start >= bodyEnd) {
      break;
    }
    if (tag.closing) {
      cursor = tag.end;
      continue;
    }
    if (tag.name === "invoke" || tag.name === "function") {
      const innerClose = findMatchingClose(text, tag);
      const call = parseInvokeOrFunction(
        text,
        tag,
        innerClose && innerClose.start < bodyEnd ? innerClose : null,
        calls.length,
      );
      if (call) {
        call.index = calls.length;
        calls.push(call);
      }
      cursor = innerClose && innerClose.start < bodyEnd ? innerClose.end : bodyEnd;
      continue;
    }
    cursor = tag.end;
  }

  if (!calls.length) {
    return parseJsonToolPayload(inner);
  }
  return calls;
}

function findToolBlockStart(text: string, from: number): ParsedTag | null {
  let cursor = from;
  while (cursor < text.length) {
    const tag = nextTag(text, cursor);
    if (!tag) {
      return null;
    }
    if (!tag.closing && TOOL_BLOCK_NAMES.has(tag.name)) {
      return tag;
    }
    cursor = tag.end;
  }
  return null;
}

export function looksLikeTextToolCall(text: string): boolean {
  if (!text) {
    return false;
  }
  return (
    /<\s*\/?\s*[|\uFF5C]?\s*DSML\s*[|\uFF5C]/i.test(text) ||
    /<\s*tool_calls?\b/i.test(text) ||
    /<\s*function_calls?\b/i.test(text) ||
    /<\s*invoke\b[^>]*\bname\s*=/i.test(text) ||
    /<\s*function\s*=/i.test(text)
  );
}

function collapseResidualContent(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+$/g, "")
    .trimEnd();
}

export function extractTextToolCalls(
  text: string,
  options: { allowIncomplete?: boolean } = {},
): ExtractedTextToolCalls {
  if (!text) {
    return { content: "", toolCalls: [], rest: "" };
  }
  if (!looksLikeTextToolCall(text)) {
    return { content: text, toolCalls: [], rest: "" };
  }

  const toolCalls: ToolCallDelta[] = [];
  let content = "";
  let cursor = 0;

  while (cursor < text.length) {
    const open = findToolBlockStart(text, cursor);
    if (!open) {
      content += text.slice(cursor);
      cursor = text.length;
      break;
    }
    content += text.slice(cursor, open.start);
    const close = findMatchingClose(text, open);
    if (!close && !options.allowIncomplete) {
      return {
        content: collapseResidualContent(content),
        toolCalls,
        rest: text.slice(open.start),
      };
    }
    const parsed = parseToolRegion(text, open, close);
    if (!parsed.length) {
      if (!close) {
        return {
          content: collapseResidualContent(content),
          toolCalls,
          rest: text.slice(open.start),
        };
      }
      content += text.slice(open.start, close.end);
      cursor = close.end;
      continue;
    }
    for (const call of parsed) {
      call.index = toolCalls.length;
      toolCalls.push(call);
    }
    cursor = close ? close.end : text.length;
  }

  return {
    content: collapseResidualContent(content),
    toolCalls,
    rest: "",
  };
}

function isPrefixOfCandidate(partial: string): boolean {
  if (!partial.startsWith("<")) {
    return false;
  }
  const normalized = normalizeDsmlBars(partial).replace(/\s+/g, " ");
  return START_TOKEN_CANDIDATES.some((candidate) => {
    const compact = candidate.replace(/\s+/g, " ");
    return (
      compact.startsWith(normalized) ||
      candidate.startsWith(partial) ||
      compact.startsWith(normalizeDsmlBars(partial))
    );
  });
}

function isPartialDsmlOpen(partial: string): boolean {
  return (
    /^<\s*$/.test(partial) ||
    /^<\s*[|\uFF5C]/.test(partial) ||
    /^<\s*[|\uFF5C]\s*D/i.test(partial) ||
    /^<\s*[|\uFF5C]\s*DSML/i.test(partial) ||
    /^<\s*\/\s*[|\uFF5C]/.test(partial)
  );
}

export function holdbackPartialToolMarkup(buffer: string): {
  emit: string;
  hold: string;
} {
  const open = findToolBlockStart(buffer, 0);
  if (open) {
    const close = findMatchingClose(buffer, open);
    if (close) {
      return { emit: buffer, hold: "" };
    }
    return {
      emit: buffer.slice(0, open.start),
      hold: buffer.slice(open.start),
    };
  }

  const lastLt = buffer.lastIndexOf("<");
  if (lastLt < 0) {
    return { emit: buffer, hold: "" };
  }
  const partial = buffer.slice(lastLt);
  if (partial.includes(">")) {
    return { emit: buffer, hold: "" };
  }
  if (isPrefixOfCandidate(partial) || isPartialDsmlOpen(partial)) {
    return {
      emit: buffer.slice(0, lastLt),
      hold: partial,
    };
  }
  return { emit: buffer, hold: "" };
}

function assistantText(message: ChatMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => ("text" in part ? part.text : ""))
      .join("");
  }
  return "";
}

/**
 * If assistant content still contains DSML/XML/Hermes markup, strip it and
 * promote parsed calls when the stream did not already yield toolCalls.
 * Used by the GUI recover path, subagents, and eval (streamChat wrappers
 * that bypass BaseLLM still need this).
 */
export function hydrateAssistantTextToolCalls(
  content: string,
  toolCalls: ToolCallDelta[] = [],
): { content: string; toolCalls: ToolCallDelta[] } {
  const named = toolCalls.filter((call) => call.function?.name);
  if (!looksLikeTextToolCall(content)) {
    return { content, toolCalls: named };
  }
  const extracted = extractTextToolCalls(content, { allowIncomplete: true });
  return {
    content: extracted.content,
    toolCalls: named.length ? named : extracted.toolCalls,
  };
}

function toMessages(extracted: ExtractedTextToolCalls): ChatMessage[] {
  const out: ChatMessage[] = [];
  if (extracted.content) {
    out.push({ role: "assistant", content: extracted.content });
  }
  if (extracted.toolCalls.length) {
    out.push({
      role: "assistant",
      content: "",
      toolCalls: extracted.toolCalls,
    });
  }
  return out;
}

export class IncrementalTextToolCallParser {
  private buffer = "";

  push(message: ChatMessage): ChatMessage[] {
    if (message.role !== "assistant") {
      return [...this.flushContent(), message];
    }

    if (message.toolCalls?.length) {
      const out = this.consume(false);
      out.push(message);
      return out;
    }

    const text = assistantText(message);
    if (!text) {
      if (
        (message as { reasoning?: string }).reasoning ||
        (message as { knoxMsMeta?: unknown }).knoxMsMeta
      ) {
        return [message];
      }
      return [];
    }

    this.buffer += text;
    return this.emitReady();
  }

  end(): ChatMessage[] {
    return this.consume(true);
  }

  private emitReady(): ChatMessage[] {
    const { emit, hold } = holdbackPartialToolMarkup(this.buffer);
    if (!looksLikeTextToolCall(this.buffer)) {
      this.buffer = hold;
      return emit ? [{ role: "assistant", content: emit }] : [];
    }

    const extracted = extractTextToolCalls(this.buffer, {
      allowIncomplete: false,
    });
    this.buffer = extracted.rest;
    return toMessages(extracted);
  }

  private consume(allowIncomplete: boolean): ChatMessage[] {
    if (!this.buffer) {
      return [];
    }
    const extracted = extractTextToolCalls(this.buffer, { allowIncomplete });
    this.buffer = "";
    const messages = toMessages(extracted);
    if (allowIncomplete && extracted.rest && !extracted.toolCalls.length) {
      messages.push({ role: "assistant", content: extracted.rest });
    }
    return messages;
  }

  private flushContent(): ChatMessage[] {
    if (!this.buffer) {
      return [];
    }
    const content = this.buffer;
    this.buffer = "";
    return [{ role: "assistant", content }];
  }
}

export async function* mapTextToolCallStream(
  source: AsyncIterable<ChatMessage>,
): AsyncGenerator<ChatMessage> {
  const parser = new IncrementalTextToolCallParser();
  for await (const message of source) {
    for (const out of parser.push(message)) {
      yield out;
    }
  }
  for (const out of parser.end()) {
    yield out;
  }
}
