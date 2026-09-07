import { incrementalParseJson } from "core/util/incrementalParseJson";

/** Argument names that typically contain file paths. */
export const FILEPATH_KEYS = [
  "target_file",
  "filepath",
  "file_path",
  "path",
  "file",
  "filename",
  "relativeFilepath",
  "outputPath",
] as const;

/**
 * Argument names that typically contain generated code.
 * Prefer new/replacement content over the text being replaced.
 */
export const CODE_CONTENT_KEYS = [
  "code_edit",
  "contents",
  "content",
  "code",
  "new_contents",
  "new_string",
  "replacement",
  "patch",
  "diff",
  "body",
  "text",
  "source",
  "old_string",
] as const;

export interface StreamingToolCode {
  filepath: string;
  codeContent: string;
  contentKey?: string;
  /** True once a path or code field has appeared in the stream. */
  started: boolean;
}

function asArgsRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function findArgByKeys(
  args: Record<string, unknown>,
  keys: readonly string[],
): { key: string; value: string } | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) {
      return { key, value };
    }
  }
  return undefined;
}

function findNestedContent(
  args: Record<string, unknown>,
): { key: string; value: string } | undefined {
  const modification = args.modification;
  if (!modification || typeof modification !== "object" || Array.isArray(modification)) {
    return undefined;
  }
  const content = (modification as { content?: unknown }).content;
  if (typeof content === "string" && content.length > 0) {
    return { key: "content", value: content };
  }
  return undefined;
}

function unescapeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
}

function extractJsonStringField(
  raw: string,
  key: string,
): string | undefined {
  const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"?`);
  const match = raw.match(pattern);
  if (match && match[1] !== undefined) {
    return unescapeJsonString(match[1]);
  }
  return undefined;
}

function extractFieldFromRaw(
  raw: string,
  keys: readonly string[],
): { key: string; value: string } | undefined {
  for (const key of keys) {
    const value = extractJsonStringField(raw, key);
    if (value !== undefined && value.length > 0) {
      return { key, value };
    }
  }
  return undefined;
}

function fieldStartedInRaw(raw: string, keys: readonly string[]): boolean {
  return keys.some((key) => new RegExp(`"${key}"\\s*:\\s*"`).test(raw));
}

/**
 * Pull filepath + code out of tool-call args while they are still streaming.
 * Uses parsed args first, then incremental JSON, then regex on the raw string
 * so a preview can render before the JSON object is complete.
 */
export function extractStreamingToolCode(options: {
  parsedArgs?: unknown;
  rawArguments?: unknown;
}): StreamingToolCode {
  const parsed = asArgsRecord(options.parsedArgs) ?? {};
  const raw =
    typeof options.rawArguments === "string" ? options.rawArguments : "";

  let fromRaw: Record<string, unknown> = {};
  if (raw) {
    const [, incrementallyParsed] = incrementalParseJson(raw);
    fromRaw = asArgsRecord(incrementallyParsed) ?? {};
  }

  const merged = { ...fromRaw, ...parsed };

  const filepathHit =
    findArgByKeys(merged, FILEPATH_KEYS) ??
    (raw ? extractFieldFromRaw(raw, FILEPATH_KEYS) : undefined);

  const contentHit =
    findNestedContent(merged) ??
    findArgByKeys(merged, CODE_CONTENT_KEYS) ??
    (raw ? extractFieldFromRaw(raw, CODE_CONTENT_KEYS) : undefined);

  let codeContent = contentHit?.value ?? "";
  if (!codeContent && raw && fieldStartedInRaw(raw, CODE_CONTENT_KEYS)) {
    for (const key of CODE_CONTENT_KEYS) {
      const extracted = extractJsonStringField(raw, key);
      if (extracted !== undefined) {
        codeContent = extracted;
        break;
      }
    }
  }

  const filepath = filepathHit?.value ?? "";
  const started =
    filepath.length > 0 ||
    codeContent.length > 0 ||
    (!!raw && fieldStartedInRaw(raw, [...FILEPATH_KEYS, ...CODE_CONTENT_KEYS]));

  return {
    filepath,
    codeContent,
    contentKey: contentHit?.key,
    started,
  };
}

export function displayArgsForToolCall(
  parsedArgs: unknown,
  rawArguments?: unknown,
): Record<string, unknown> {
  const parsed = asArgsRecord(parsedArgs) ?? {};
  const extracted = extractStreamingToolCode({ parsedArgs, rawArguments });
  return {
    ...parsed,
    ...(extracted.filepath ? { filepath: extracted.filepath } : {}),
  };
}

export function calculateFence(contents: string): string {
  const backtickMatches = contents.match(/`{3,}/g);
  if (backtickMatches) {
    const maxLength = Math.max(...backtickMatches.map((m) => m.length));
    return "`".repeat(maxLength + 1);
  }
  return "```";
}
