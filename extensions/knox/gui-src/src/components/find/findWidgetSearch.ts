export type SearchPattern =
  | { kind: "literal"; value: string; caseSensitive: boolean }
  | { kind: "regex"; regex: RegExp }
  | { kind: "invalid"; error: string };

export function compileSearchPattern(
  query: string,
  options: { caseSensitive: boolean; useRegex: boolean },
): SearchPattern {
  if (!query) {
    return { kind: "literal", value: "", caseSensitive: options.caseSensitive };
  }

  if (!options.useRegex) {
    return {
      kind: "literal",
      value: options.caseSensitive ? query : query.toLowerCase(),
      caseSensitive: options.caseSensitive,
    };
  }

  try {
    const flags = options.caseSensitive ? "g" : "gi";
    return { kind: "regex", regex: new RegExp(query, flags) };
  } catch (e) {
    return {
      kind: "invalid",
      error: e instanceof Error ? e.message : "Invalid regular expression",
    };
  }
}

export function textMatchesPattern(
  text: string,
  pattern: SearchPattern,
): boolean {
  if (pattern.kind === "invalid") {
    return false;
  }
  if (pattern.kind === "literal") {
    if (!pattern.value) {
      return false;
    }
    const haystack = pattern.caseSensitive ? text : text.toLowerCase();
    return haystack.includes(pattern.value);
  }
  pattern.regex.lastIndex = 0;
  return pattern.regex.test(text);
}

/**
 * Return [start, end) ranges for matches of `pattern` within `text`.
 */
export function findMatchRanges(
  text: string,
  pattern: SearchPattern,
): Array<{ start: number; end: number }> {
  if (pattern.kind === "invalid" || !text) {
    return [];
  }

  const ranges: Array<{ start: number; end: number }> = [];

  if (pattern.kind === "literal") {
    if (!pattern.value) {
      return [];
    }
    const haystack = pattern.caseSensitive ? text : text.toLowerCase();
    const needle = pattern.value;
    let startIndex = 0;
    while ((startIndex = haystack.indexOf(needle, startIndex)) !== -1) {
      const endIndex = startIndex + needle.length;
      ranges.push({ start: startIndex, end: endIndex });
      startIndex = endIndex;
    }
    return ranges;
  }

  pattern.regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.regex.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (end === start) {
      // Avoid infinite loop on zero-width matches
      pattern.regex.lastIndex = start + 1;
      continue;
    }
    ranges.push({ start, end });
    if (!pattern.regex.global) {
      break;
    }
  }
  return ranges;
}
