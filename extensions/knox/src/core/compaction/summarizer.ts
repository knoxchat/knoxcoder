import { ChatMessage } from "../index.js";
import { renderChatMessage } from "../util/messageContent.js";
import { TASK_EXECUTION_PLAN_MARKER } from "../tools/planStore.js";
import {
  DEVELOPMENT_LOOP_STATE_MARKER,
  LAST_BUILD_ERRORS_MARKER,
  looksLikeVerboseBuildLog,
  summarizeBuildLog,
} from "./loopState.js";
import { formatOops, parseOops } from "../tools/build/parseOops.js";
import { formatQemuMonitor, parseQemuMonitor } from "../tools/build/parseQemuMonitor.js";
import { LlmCompleteFn } from "./types.js";

/** Rough token estimate — avoids importing countTokens (circular with compaction). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Summarizer for older conversation messages.
 *
 * Two strategies:
 * 1. Heuristic (fast, no LLM call) — extracts key sentences/decisions
 * 2. LLM-based (higher quality, async) — calls the model to summarize
 *
 * The heuristic summarizer is used by default to avoid extra latency.
 */

export const CONVERSATION_SUMMARY_MARKER = "[Conversation Summary]";

/** Content markers that must survive compaction (memory inject / plans / oracles). */
export const MEMORY_PROTECTED_MARKERS = [
  "Relevant Memory Context",
  "Relevant Knowledge from Memory",
  "<memory-context>",
  "[pinned]",
  TASK_EXECUTION_PLAN_MARKER,
  DEVELOPMENT_LOOP_STATE_MARKER,
  LAST_BUILD_ERRORS_MARKER,
  "verifyCommand:",
] as const;

export function isMemoryProtectedContent(text: string): boolean {
  return MEMORY_PROTECTED_MARKERS.some((marker) => text.includes(marker));
}

export function isConversationSummaryContent(text: string): boolean {
  return text.includes(CONVERSATION_SUMMARY_MARKER);
}

/**
 * Heuristic summarization: extracts the most important parts of a message.
 *
 * Strategy:
 * - For user messages: keep the first sentence (usually the intent) + any
 *   code blocks references (filenames, function names)
 * - For assistant messages: keep the first sentence + any code fences
 *   (reduced to signature-only) + any bulleted conclusions
 * - For tool messages: keep tool name + result status, drop verbose output
 */
export function heuristicSummarize(
  message: ChatMessage,
  maxChars: number = 500,
): string {
  const content = renderChatMessage(message);

  if (content.length <= maxChars) {
    return content;
  }

  switch (message.role) {
    case "user":
      return summarizeUserMessage(content, maxChars);
    case "assistant":
      return summarizeAssistantMessage(content, maxChars);
    case "tool":
      return summarizeToolMessage(content, maxChars);
    case "thinking":
      // Thinking blocks can be aggressively summarized
      return content.substring(0, Math.min(200, maxChars)) + "...";
    default:
      return content.substring(0, maxChars) + "...";
  }
}

function summarizeUserMessage(content: string, maxChars: number): string {
  const parts: string[] = [];

  // Keep first sentence (the intent)
  const firstSentence = extractFirstSentence(content);
  parts.push(firstSentence);

  // Extract file/path references
  const fileRefs = extractFileReferences(content);
  if (fileRefs.length > 0) {
    parts.push(`[Files: ${fileRefs.join(", ")}]`);
  }

  // If user included code, note it
  if (content.includes("```")) {
    const codeBlockCount = (content.match(/```/g) || []).length / 2;
    parts.push(`[Included ${Math.floor(codeBlockCount)} code block(s)]`);
  }

  const result = parts.join("\n");
  if (result.length > maxChars) {
    return result.substring(0, maxChars) + "...";
  }
  return result;
}

function summarizeAssistantMessage(content: string, maxChars: number): string {
  const parts: string[] = [];

  // Keep first paragraph (usually the summary/answer)
  const firstParagraph = content.split("\n\n")[0];
  parts.push(
    firstParagraph.length > maxChars / 2
      ? firstParagraph.substring(0, maxChars / 2) + "..."
      : firstParagraph,
  );

  // Extract code block signatures (first line of each block)
  const codeSignatures = extractCodeSignatures(content);
  if (codeSignatures.length > 0) {
    parts.push("[Code changes:]");
    for (const sig of codeSignatures.slice(0, 5)) {
      parts.push(`  ${sig}`);
    }
    if (codeSignatures.length > 5) {
      parts.push(`  ...and ${codeSignatures.length - 5} more`);
    }
  }

  // Extract bullet conclusions (lines starting with - or *)
  const bullets = content
    .split("\n")
    .filter((l) => /^\s*[-*]\s/.test(l))
    .slice(-3);
  if (bullets.length > 0) {
    parts.push(...bullets);
  }

  const result = parts.join("\n");
  if (result.length > maxChars) {
    return result.substring(0, maxChars) + "...";
  }
  return result;
}

function summarizeToolMessage(content: string, maxChars: number): string {
  if (looksLikeVerboseBuildLog(content)) {
    return summarizeBuildLog(content, maxChars);
  }

  const oops = parseOops(content);
  const monitor = parseQemuMonitor(content);
  const jobIds = Array.from(
    content.matchAll(/\bjob_id["']?\s*[:=]\s*["']?([A-Za-z0-9_-]+)/gi),
    (match) => match[1],
  );
  if (oops || monitor) {
    const parts = [
      oops ? formatOops(oops) : "",
      monitor ? formatQemuMonitor(monitor) : "",
      jobIds.length ? `job_id: ${[...new Set(jobIds)].slice(0, 8).join(", ")}` : "",
    ].filter(Boolean);
    const result = parts.join("\n");
    return result.length > maxChars ? result.slice(0, maxChars) + "..." : result;
  }

  // Tool messages often contain large outputs. Keep just the status.
  const lines = content.split("\n");

  // Take first few lines (usually the status/result indicator)
  const header = lines.slice(0, 3).join("\n");

  // Check for error indicators
  const hasError =
    content.toLowerCase().includes("error") ||
    content.toLowerCase().includes("failed");

  if (hasError) {
    // Keep error details
    const errorLines = lines.filter(
      (l) =>
        l.toLowerCase().includes("error") ||
        l.toLowerCase().includes("failed") ||
        l.toLowerCase().includes("exception"),
    );
    const errorSummary = errorLines.slice(0, 5).join("\n");
    const result = `${header}\n[Error detected]\n${errorSummary}`;
    return result.length > maxChars
      ? result.substring(0, maxChars) + "..."
      : result;
  }

  // For successful tool outputs, just keep the header + line count
  const lineCount = lines.length;
  const result =
    lineCount > 5
      ? `${header}\n[...${lineCount - 3} more lines of output]`
      : content;
  return result.length > maxChars
    ? result.substring(0, maxChars) + "..."
    : result;
}

// --- Utility helpers ---

function extractFirstSentence(text: string): string {
  // Match up to the first sentence-ending punctuation
  const match = text.match(/^[^.!?\n]+[.!?]?/);
  return match ? match[0].trim() : text.substring(0, 150);
}

function extractFileReferences(text: string): string[] {
  // Match common file path patterns
  const fileRegex =
    /(?:^|\s|["'`(])([a-zA-Z0-9_\-./]+\.[a-zA-Z]{1,10})(?:\s|["'`)]|$|:)/gm;
  const refs = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = fileRegex.exec(text)) !== null) {
    const ref = match[1];
    // Filter out URLs and very short matches
    if (!ref.includes("://") && ref.length > 3) {
      refs.add(ref);
    }
  }
  return Array.from(refs).slice(0, 10);
}

function extractCodeSignatures(content: string): string[] {
  const signatures: string[] = [];
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const lang = match[1] || "code";
    const body = match[2].trim();
    const firstLine = body.split("\n")[0];
    signatures.push(`[${lang}] ${firstLine}`);
  }
  return signatures;
}

/**
 * Build a compact summary header from multiple older messages.
 * This creates a single "conversation summary" block.
 */
export function buildConversationSummary(
  messages: ChatMessage[],
  maxChars: number = 1500,
): string {
  const summaries: string[] = [CONVERSATION_SUMMARY_MARKER];
  let charBudget = maxChars - summaries[0].length;

  for (const msg of messages) {
    // Never fold protected memory / plan content into the heuristic summary body
    if (msg.role === "system" && isMemoryProtectedContent(renderChatMessage(msg))) {
      continue;
    }
    const summary = heuristicSummarize(msg, Math.min(300, charBudget));
    const line = `- ${msg.role}: ${summary.split("\n")[0]}`;

    if (charBudget - line.length < 0) break;
    summaries.push(line);
    charBudget -= line.length;
  }

  return summaries.join("\n");
}

function truncateMessagesForLlmInput(
  messages: ChatMessage[],
  maxInputTokens: number,
): string {
  const lines: string[] = [];
  let tokens = 0;

  for (const msg of messages) {
    if (msg.role === "system" && isMemoryProtectedContent(renderChatMessage(msg))) {
      continue;
    }

    let body = renderChatMessage(msg);
    if (msg.role === "assistant" && "toolCalls" in msg && msg.toolCalls?.length) {
      const names = msg.toolCalls
        .map((tc) => tc.function?.name)
        .filter(Boolean)
        .join(", ");
      body = `${body}\n[tool_calls: ${names}]`.trim();
    }
    if (msg.role === "tool" && "toolCallId" in msg) {
      body = `[tool_result ${msg.toolCallId}] ${body}`;
    }

    // Cap per-message so one huge tool dump doesn't monopolize the budget
    const perMsgCap = Math.max(200, Math.floor(maxInputTokens / 4));
    const bodyTokens = estimateTokens(body);
    if (bodyTokens > perMsgCap) {
      const ratio = perMsgCap / bodyTokens;
      body = body.substring(0, Math.max(100, Math.floor(body.length * ratio))) + "…";
    }

    const line = `${msg.role.toUpperCase()}: ${body}`;
    const lineTokens = estimateTokens(line) + 4;
    if (tokens + lineTokens > maxInputTokens) {
      if (lines.length === 0) {
        lines.push(line.substring(0, 500) + "…");
      }
      break;
    }
    lines.push(line);
    tokens += lineTokens;
  }

  return lines.join("\n\n");
}

/**
 * Ask an LLM to summarize older conversation turns.
 * Returns null on timeout, abort, empty response, or thrown errors
 * so callers can fall back to the heuristic summarizer.
 */
export async function llmSummarizeConversation(
  messages: ChatMessage[],
  options: {
    complete: LlmCompleteFn;
    modelName: string;
    maxSummaryTokens: number;
    maxInputTokens: number;
    timeoutMs: number;
  },
): Promise<string | null> {
  if (messages.length === 0) return null;

  const transcript = truncateMessagesForLlmInput(
    messages,
    options.maxInputTokens,
  );
  if (!transcript.trim()) return null;

  const maxChars = Math.max(200, options.maxSummaryTokens * 4);
  const prompt = [
    "You are compacting an earlier portion of a coding-agent conversation.",
    "Write a concise summary that preserves:",
    "- User goals and constraints",
    "- Key decisions and file/symbol names",
    "- Tool actions taken and their outcomes (success/failure)",
    "- Last compiler/linker errors (file:line) and verifyCommand",
    "- Active job_id values and QEMU/GDB session descriptors",
    "- The current Task Execution Plan",
    "- Last failing test name",
    "- Open questions or unfinished work",
    "Do NOT invent facts. Do NOT include the full tool output.",
    `Stay under ~${options.maxSummaryTokens} tokens (~${maxChars} characters).`,
    "Return plain text only (no markdown fencing).",
    "",
    "Conversation to summarize:",
    transcript,
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const raw = await options.complete(prompt, controller.signal);
    const text = (raw ?? "").trim();
    if (!text) return null;

    const clipped =
      text.length > maxChars ? text.substring(0, maxChars) + "…" : text;
    return `${CONVERSATION_SUMMARY_MARKER}\n${clipped}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
