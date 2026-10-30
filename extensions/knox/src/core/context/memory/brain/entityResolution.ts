/**
 * MEM-26 — entity resolution + validity intervals (pure).
 *
 * Aliases such as TS / TypeScript share one graph node via `canonical_id`.
 * Facts, entities, and edges carry `valid_from` / `valid_to`. Open bounds
 * (NULL) stay valid. Ω(q) keeps only rows valid at query time.
 *
 * Rule groups only — no embeddings.
 */

/** Preferred name first. Lookup is case-insensitive and ignores `.` / `-` / `_` / `/`. */
export const ENTITY_ALIAS_GROUPS: readonly (readonly string[])[] = [
  ["TypeScript", "TS", "Typescript"],
  ["JavaScript", "JS", "Javascript", "ECMAScript"],
  ["Kubernetes", "k8s", "K8s"],
  ["PostgreSQL", "Postgres"],
  ["MongoDB", "Mongo"],
  ["Node.js", "NodeJS", "nodejs"],
  ["Next.js", "NextJS", "nextjs"],
  ["VS Code", "VSCode", "vscode"],
  ["C++", "cpp", "cxx"],
  ["C#", "csharp"],
  ["WebSocket", "WebSockets"],
];

const ALIAS_GROUP_BY_KEY = new Map<string, readonly string[]>();
for (const group of ENTITY_ALIAS_GROUPS) {
  for (const name of group) {
    ALIAS_GROUP_BY_KEY.set(normalizeEntityName(name), group);
    ALIAS_GROUP_BY_KEY.set(entityNameKey(name), group);
  }
}

export function normalizeEntityName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Compact key so `Node.js` and `nodejs` land in the same group. */
export function entityNameKey(name: string): string {
  return normalizeEntityName(name).replace(/[.\-_/]/g, "");
}

export function entityAliasGroup(name: string): readonly string[] | undefined {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  return ALIAS_GROUP_BY_KEY.get(normalizeEntityName(trimmed))
    ?? ALIAS_GROUP_BY_KEY.get(entityNameKey(trimmed));
}

export function isKnownEntityAlias(name: string): boolean {
  return entityAliasGroup(name) != null;
}

export function preferredEntityName(name: string): string {
  const group = entityAliasGroup(name);
  return group?.[0] ?? name.trim();
}

export function entityAliasNames(name: string): string[] {
  const group = entityAliasGroup(name);
  if (!group) return [];
  const key = entityNameKey(name);
  return group.filter((alias) => entityNameKey(alias) !== key);
}

export function namesShareAliasGroup(a: string, b: string): boolean {
  const left = entityAliasGroup(a);
  const right = entityAliasGroup(b);
  return left != null && left === right;
}

export type ValidityBounds = {
  valid_from?: string | null;
  valid_to?: string | null;
};

/**
 * Parse sqlite `YYYY-MM-DD HH:MM:SS` or ISO-8601 into epoch ms.
 * NULL / empty / unparseable → null (open bound).
 */
export function parseValidityInstant(value: string | null | undefined): number | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const iso = /T/.test(trimmed) || /[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)
    ? trimmed
    : trimmed.includes(" ")
      ? `${trimmed.replace(" ", "T")}Z`
      : trimmed;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export function resolveQueryInstant(at?: Date | string | number): number {
  if (at instanceof Date) return at.getTime();
  if (typeof at === "number" && Number.isFinite(at)) return at;
  if (typeof at === "string") {
    const parsed = parseValidityInstant(at);
    if (parsed != null) return parsed;
  }
  return Date.now();
}

/**
 * Open interval: NULL `valid_from` / `valid_to` means unbounded.
 * End is exclusive so a just-superseded row (`valid_to = now`) leaves Ω(q).
 */
export function isValidAt(row: ValidityBounds, at?: Date | string | number): boolean {
  const when = resolveQueryInstant(at);
  const from = parseValidityInstant(row.valid_from ?? null);
  const to = parseValidityInstant(row.valid_to ?? null);
  if (from != null && from > when) return false;
  if (to != null && to <= when) return false;
  return true;
}

export function filterValidAt<T extends ValidityBounds>(
  rows: T[],
  at?: Date | string | number,
): T[] {
  return rows.filter((row) => isValidAt(row, at));
}

function wordBoundaryMention(haystack: string, needle: string): boolean {
  const n = needle.trim();
  if (!n || !haystack) return false;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?:[^A-Za-z0-9_]|$)`, "i").test(haystack);
}

/** Query (or memory text) mentions `name` or any rule alias of it. */
export function textMentionsEntityAliases(text: string, name: string): boolean {
  if (!text?.trim() || !name.trim()) return false;
  const names = [name.trim(), ...entityAliasNames(name)];
  for (const alias of names) {
    if (wordBoundaryMention(text, alias)) return true;
  }
  return false;
}

/** Tokens from a query that belong to a known alias group (including short `TS`). */
export function knownAliasTokens(query: string): string[] {
  if (!query?.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const tokens = query.match(/[A-Za-z0-9+#]+/g) ?? [];
  for (const token of tokens) {
    const group = entityAliasGroup(token);
    if (!group) continue;
    const key = entityNameKey(token);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}
