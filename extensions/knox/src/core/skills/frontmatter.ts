/**
 * Frontmatter parser for SKILL.md files.
 *
 * Uses the `yaml` package for full YAML parsing (matching opencode's
 * gray-matter behaviour). Includes fallback sanitization for sloppy
 * frontmatter (e.g. unquoted colons in values) that other coding agents
 * like Claude Code may produce.
 *
 * Falls back gracefully: if frontmatter is missing or unparseable the file
 * is skipped without throwing.
 */

import YAML from "yaml";

export interface FrontmatterResult {
  /** Parsed key-value pairs from the YAML block */
  data: Record<string, string>;
  /** Markdown body after the closing `---` */
  content: string;
}

/**
 * Regex patterns for template features in skill content.
 *
 * `@file` references: `@./path/to/file` or `@relative/path`
 * `!shell` commands: `` !`command here` ``
 */
export const FILE_REGEX = /(?<![\w`])@(\.?[^\s`,.]*(?:\.[^\s`,.]+)*)/g;
export const SHELL_REGEX = /!`([^`]+)`/g;

/**
 * Extract all `@file` references from skill content.
 */
export function extractFileRefs(template: string): RegExpMatchArray[] {
  return Array.from(template.matchAll(FILE_REGEX));
}

/**
 * Extract all `` !`shell` `` references from skill content.
 */
export function extractShellRefs(template: string): RegExpMatchArray[] {
  return Array.from(template.matchAll(SHELL_REGEX));
}

/**
 * Sanitize sloppy YAML frontmatter that may be invalid.
 *
 * Other coding agents like Claude Code allow invalid YAML in their
 * frontmatter. This converts problematic patterns (e.g. unquoted colons
 * in values) to block scalars so the YAML parser can handle them.
 *
 * Matches opencode's `ConfigMarkdown.fallbackSanitization`.
 */
export function fallbackSanitization(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return content;

  const frontmatter = match[1];
  const lines = frontmatter.split(/\r?\n/);
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // skip comments and empty lines
    if (trimmed.startsWith("#") || trimmed === "") {
      result.push(line);
      continue;
    }

    // skip continuation lines (indented)
    if (line.match(/^\s+/)) {
      result.push(line);
      continue;
    }

    // match key: value pattern
    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (!kvMatch) {
      result.push(line);
      continue;
    }

    const key = kvMatch[1];
    const value = kvMatch[2].trim();

    // skip if value is empty, already quoted, or uses block scalar
    if (
      value === "" ||
      value === ">" ||
      value === "|" ||
      value.startsWith('"') ||
      value.startsWith("'")
    ) {
      result.push(line);
      continue;
    }

    // if value contains a colon, convert to block scalar
    if (value.includes(":")) {
      result.push(`${key}: |-`);
      result.push(`  ${value}`);
      continue;
    }

    result.push(line);
  }

  const processed = result.join("\n");
  return content.replace(frontmatter, () => processed);
}

/**
 * Parse a SKILL.md file's raw text into frontmatter data + body content.
 *
 * Returns `undefined` when the text does not start with a valid `---` block,
 * or when the YAML is unparseable even after sanitization.
 */
export function parseFrontmatter(raw: string): FrontmatterResult | undefined {
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Must start with `---` (optionally preceded by whitespace-only lines)
  if (!text.startsWith("---")) {
    return undefined;
  }

  // Find the closing `---`
  const endIndex = text.indexOf("\n---", 3);
  if (endIndex === -1) {
    return undefined;
  }

  const yamlBlock = text.slice(3, endIndex).trim();
  const body = text.slice(endIndex + 4).replace(/^\n/, ""); // skip the closing ---\n

  // Try full YAML parsing first
  let data = tryParseYaml(yamlBlock);

  // Fallback: sanitize and retry
  if (!data) {
    const sanitized = fallbackSanitization(`---\n${yamlBlock}\n---`);
    const sanitizedMatch = sanitized.match(/^---\n([\s\S]*?)\n---/);
    if (sanitizedMatch) {
      data = tryParseYaml(sanitizedMatch[1]);
    }
  }

  // Last resort: simple key-value parsing (for extremely malformed YAML)
  if (!data) {
    data = simpleKeyValueParse(yamlBlock);
  }

  if (!data) {
    return undefined;
  }

  return { data, content: body };
}

/**
 * Try to parse a YAML string into a Record<string, string>.
 * Returns undefined on failure. Returns empty object for empty YAML.
 */
function tryParseYaml(yamlStr: string): Record<string, string> | undefined {
  try {
    const parsed = YAML.parse(yamlStr);
    // Empty YAML block is valid but parses to null/undefined
    if (parsed === null || parsed === undefined) {
      return {};
    }
    if (typeof parsed === "object" && !Array.isArray(parsed)) {
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        result[key] = String(value);
      }
      return result;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fallback simple key: value parser for extremely malformed YAML.
 * Only handles single-line `key: value` pairs.
 */
function simpleKeyValueParse(
  yamlBlock: string,
): Record<string, string> | undefined {
  const data: Record<string, string> = {};

  for (const line of yamlBlock.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) {
      data[key] = value;
    }
  }

  return Object.keys(data).length > 0 ? data : undefined;
}
