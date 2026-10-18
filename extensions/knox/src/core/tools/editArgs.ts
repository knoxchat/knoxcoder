/**
 * Shared argument recovery for builtin_edit_file.
 *
 * Models mix Claude/Pi/Codex/JS names, send line arrays instead of strings,
 * and often truncate a long `edits` list so the last object is incomplete.
 */

export const EDIT_OLD_KEYS = [
  "old_string",
  "oldText",
  "old_text",
  "oldString",
  "old_str",
  "search",
  "from",
  "original",
  "old",
] as const;

export const EDIT_NEW_KEYS = [
  "new_string",
  "newText",
  "new_text",
  "newString",
  "new_str",
  "replace",
  "to",
  "replacement",
  "new",
] as const;

export function coerceEditText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean",
    )
  ) {
    return value.map(String).join("\n");
  }
  return undefined;
}

export function pickEditText(
  entry: Record<string, unknown> | null | undefined,
  keys: readonly string[],
): string | undefined {
  if (!entry) {
    return undefined;
  }
  for (const key of keys) {
    const text = coerceEditText(entry[key]);
    if (text !== undefined) {
      return text;
    }
  }
  return undefined;
}

function isNumericKeyedObject(raw: object): boolean {
  const keys = Object.keys(raw);
  return keys.length > 0 && keys.every((key) => /^\d+$/.test(key));
}

/** Array, JSON-string array, or `{ "0": edit, "1": edit }` → a list of entries. */
export function asEditsArray(raw: unknown): unknown[] | undefined {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    try {
      return asEditsArray(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }
  if (raw && typeof raw === "object") {
    if (isNumericKeyedObject(raw)) {
      return Object.keys(raw)
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => (raw as Record<string, unknown>)[key]);
    }
    return [raw];
  }
  return undefined;
}

export function normalizeEditEntry(entry: unknown): unknown {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return entry;
  }
  const row = { ...(entry as Record<string, unknown>) };
  if (coerceEditText(row.old_string) === undefined) {
    const oldText = pickEditText(row, EDIT_OLD_KEYS);
    if (oldText !== undefined) {
      row.old_string = oldText;
    }
  } else {
    row.old_string = coerceEditText(row.old_string);
  }
  if (coerceEditText(row.new_string) === undefined) {
    const newText = pickEditText(row, EDIT_NEW_KEYS);
    if (newText !== undefined) {
      row.new_string = newText;
    }
  } else {
    row.new_string = coerceEditText(row.new_string);
  }
  if (row.replace_all === undefined && row.replaceAll !== undefined) {
    row.replace_all = row.replaceAll;
  }
  return row;
}
