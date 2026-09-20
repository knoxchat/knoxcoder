/**
 * Optional citation check: does a quoted file actually support the claim?
 *
 * String-match the quote first (fabricated if missing). Surviving quotes
 * get a Choice(supports / contradicts / says_nothing). Fail-open: skip.
 */

import type { ChatMessage } from "..";
import { createKnoxLogger } from "../util/knoxLog";
import { asChoice } from "./answers";
import { resolveJevClient } from "./client";
import { getActiveJevRuntime } from "./config";
import {
  CITATION_CLAIM_MAX_CHARS,
  CITATION_CONFIDENCE_AUTO,
  CITATION_MAX_BATCH,
  CITATION_QUOTE_MAX_CHARS,
  CITATION_SOURCE_MAX_CHARS,
  CITATION_VERDICT,
  citationRelationQuestion,
  type JevCitationVerdict,
} from "./questions";
import type { JevClient, JevRuntime } from "./types";

const log = createKnoxLogger("jev");

export interface CitationSource {
  path: string;
  content: string;
}

export interface ExtractedCitation {
  path: string;
  quote: string;
  claim: string;
}

export interface CitationCheckResult {
  source: "jev" | "heuristic";
  verdict: JevCitationVerdict | "skipped";
  confidence: number | null;
  auto: boolean;
  reason: string;
  path?: string;
}

const SKIPPED: CitationCheckResult = {
  source: "heuristic",
  verdict: "skipped",
  confidence: null,
  auto: true,
  reason: "Jev citation check skipped",
};

export function normalizeCitationText(text: string): string {
  const table: Record<string, string> = {
    "\u201c": '"',
    "\u201d": '"',
    "\u2018": "'",
    "\u2019": "'",
  };
  return text
    .replace(/[\u201c\u201d\u2018\u2019]/g, (ch) => table[ch] ?? ch)
    .replace(/\s+/g, " ")
    .trim();
}

export function quoteInSource(quote: string, source: string): boolean {
  const needle = normalizeCitationText(quote);
  if (needle.length < 8) {
    return false;
  }
  return normalizeCitationText(source).includes(needle);
}

function looksLikePath(value: string): boolean {
  const trimmed = value.trim().replace(/^[`'"]+|[`'"]+$/g, "");
  if (!trimmed || trimmed.length > 240) {
    return false;
  }
  if (/\s/.test(trimmed)) {
    return false;
  }
  if (trimmed.includes("/")) {
    return true;
  }
  return /\.(c|h|cc|hh|cpp|hpp|rs|ts|tsx|js|jsx|py|go|java|toml|yml|yaml|md|S|s|ld|mk)$/i.test(
    trimmed,
  );
}

function parseFenceHeader(header: string): string {
  const trimmed = header.trim();
  const cursor = trimmed.match(/^\d+:\d+:(.+)$/);
  if (cursor && looksLikePath(cursor[1])) {
    return cursor[1].trim();
  }
  const parts = trimmed.split(/\s+/);
  const last = parts[parts.length - 1] ?? "";
  return looksLikePath(last) ? last : "";
}

function lastSentence(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "";
  }
  const parts = cleaned.split(/(?<=[.!?])\s+/);
  return (parts[parts.length - 1] ?? cleaned).slice(0, CITATION_CLAIM_MAX_CHARS);
}

const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)```/g;

/** Pull path-tagged code fences out of an assistant completion. */
export function extractFileCitations(text: string): ExtractedCitation[] {
  const found: ExtractedCitation[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(FENCE_RE)) {
    const path = parseFenceHeader(match[1] ?? "");
    const quote = (match[2] ?? "").trim();
    if (!path || quote.length < 8) {
      lastIndex = (match.index ?? 0) + match[0].length;
      continue;
    }
    const before = text.slice(lastIndex, match.index ?? 0);
    found.push({
      path,
      quote: quote.slice(0, CITATION_QUOTE_MAX_CHARS),
      claim: lastSentence(before),
    });
    lastIndex = (match.index ?? 0) + match[0].length;
    if (found.length >= CITATION_MAX_BATCH) {
      break;
    }
  }
  return found;
}

function messageText(message: ChatMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => ("text" in part ? part.text : ""))
      .join("\n");
  }
  return "";
}

function toolPathFromArgs(raw: string | undefined): string {
  if (!raw) {
    return "";
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const key of ["filepath", "path", "target_file", "file"]) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  } catch {
    const match = raw.match(/"(?:filepath|path|target_file|file)"\s*:\s*"([^"]+)"/);
    if (match?.[1]) {
      return match[1];
    }
  }
  return "";
}

/** File bodies the assistant could have quoted: tool results + user context. */
export function collectSourcesFromMessages(
  messages: ChatMessage[],
): CitationSource[] {
  const sources: CitationSource[] = [];
  let pendingPath = "";
  for (const message of messages) {
    if (message.role === "assistant" && Array.isArray(message.toolCalls)) {
      for (const call of message.toolCalls) {
        const name = call.function?.name ?? "";
        if (
          /read/i.test(name) ||
          name.includes("exact_search") ||
          name.includes("grep")
        ) {
          pendingPath = toolPathFromArgs(call.function?.arguments) || pendingPath;
        }
      }
    }
    if (message.role === "tool") {
      const content = messageText(message);
      if (content.trim()) {
        sources.push({ path: pendingPath, content });
        pendingPath = "";
      }
    }
    if (message.role === "user") {
      const content = messageText(message);
      if (content.trim()) {
        sources.push({ path: "", content });
      }
    }
  }
  return sources;
}

function pathMatches(citationPath: string, sourcePath: string): boolean {
  if (!citationPath || !sourcePath) {
    return false;
  }
  const a = citationPath.replace(/\\/g, "/").toLowerCase();
  const b = sourcePath.replace(/\\/g, "/").toLowerCase();
  return a === b || a.endsWith(b) || b.endsWith(a);
}

function locateSource(
  sources: CitationSource[],
  citation: ExtractedCitation,
): { status: "found" | "missing" | "no_source"; section: string } {
  const byPath = sources.find((item) => pathMatches(citation.path, item.path));
  if (byPath) {
    if (quoteInSource(citation.quote, byPath.content)) {
      return {
        status: "found",
        section: byPath.content.slice(0, CITATION_SOURCE_MAX_CHARS),
      };
    }
    return { status: "missing", section: "" };
  }
  const byQuote = sources.find((item) => quoteInSource(citation.quote, item.content));
  if (byQuote) {
    return {
      status: "found",
      section: byQuote.content.slice(0, CITATION_SOURCE_MAX_CHARS),
    };
  }
  if (sources.length === 0) {
    return { status: "no_source", section: "" };
  }
  return { status: "missing", section: "" };
}

export async function checkCitation(input: {
  claim: string;
  quote: string;
  path?: string;
  sources: CitationSource[];
  runtime?: JevRuntime;
  client?: JevClient;
  abortSignal?: AbortSignal;
}): Promise<CitationCheckResult> {
  const runtime = input.runtime ?? getActiveJevRuntime();
  const located = locateSource(input.sources, {
    path: input.path ?? "",
    quote: input.quote,
    claim: input.claim,
  });
  if (located.status === "no_source") {
    return SKIPPED;
  }
  if (located.status === "missing") {
    return {
      source: "heuristic",
      verdict: "fabricated",
      confidence: null,
      auto: true,
      reason: "quote not found in the cited file",
      path: input.path,
    };
  }

  const client = resolveJevClient(runtime, input.client);
  if (!runtime.enabled || !client) {
    return SKIPPED;
  }

  const claim =
    input.claim.trim() ||
    `The assistant quoted ${input.path || "a file"} as evidence.`;

  try {
    const result = await client.systemOne(
      {
        model: runtime.model,
        state: {
          claim: claim.slice(0, CITATION_CLAIM_MAX_CHARS),
          section: located.section,
          quote: input.quote.slice(0, CITATION_QUOTE_MAX_CHARS),
          source_path: input.path ?? "",
        },
        questions: {
          relation: citationRelationQuestion(),
        },
      },
      { signal: input.abortSignal, timeoutMs: runtime.timeoutMs },
    );
    const relation = asChoice(result.answers, "relation");
    if (!relation) {
      return SKIPPED;
    }
    const choice = relation.choice as keyof typeof CITATION_VERDICT;
    const verdict = CITATION_VERDICT[choice] ?? "unsupported";
    const confidence = relation.confidence;
    const checked: CitationCheckResult = {
      source: "jev",
      verdict,
      confidence,
      auto: confidence >= CITATION_CONFIDENCE_AUTO,
      reason: `relation=${relation.choice} confidence=${confidence.toFixed(2)}`,
      path: input.path,
    };
    log.info(`citation ${checked.verdict} path=${input.path ?? "-"} ${checked.reason}`);
    return checked;
  } catch (error) {
    if (!runtime.failOpen) {
      throw error;
    }
    log.warn(
      `citation check failed open: ${error instanceof Error ? error.message : String(error)}`,
    );
    return SKIPPED;
  }
}

export async function checkCitations(input: {
  completion: string;
  sources: CitationSource[];
  runtime?: JevRuntime;
  client?: JevClient;
  abortSignal?: AbortSignal;
}): Promise<CitationCheckResult[]> {
  const runtime = input.runtime ?? getActiveJevRuntime();
  if (!runtime.enabled) {
    return [];
  }
  const citations = extractFileCitations(input.completion);
  if (citations.length === 0 || input.sources.length === 0) {
    return [];
  }
  return Promise.all(
    citations.map((citation) =>
      checkCitation({
        claim: citation.claim,
        quote: citation.quote,
        path: citation.path,
        sources: input.sources,
        runtime,
        client: input.client,
        abortSignal: input.abortSignal,
      }),
    ),
  );
}

export function formatCitationWarnings(results: CitationCheckResult[]): string {
  const bad = results.filter(
    (item) =>
      item.verdict === "fabricated" ||
      item.verdict === "contradicted" ||
      (item.verdict === "unsupported" && item.auto),
  );
  if (bad.length === 0) {
    return "";
  }
  return bad
    .map(
      (item) =>
        `[Jev citation] ${item.verdict} ${item.path ?? ""} ${item.reason}`.trim(),
    )
    .join("\n");
}

/** User-visible footnote after a completion (P4). */
export function formatUserCitationWarning(
  results: CitationCheckResult[],
): string {
  const bad = results.filter(
    (item) =>
      item.verdict === "fabricated" ||
      item.verdict === "contradicted" ||
      (item.verdict === "unsupported" && item.auto),
  );
  if (bad.length === 0) {
    return "";
  }
  const summary = bad
    .map((item) =>
      item.path ? `${item.verdict} (${item.path})` : item.verdict,
    )
    .join("; ");
  return `[Jev] Citation check: ${summary}. Do not treat fabricated or contradicted quotes as facts.`;
}
