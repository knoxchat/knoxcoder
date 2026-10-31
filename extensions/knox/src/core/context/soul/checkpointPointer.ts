/**
 * MEM-38 — checkpoint metadata as an M₃/M₄ pointer leaf.
 *
 * Workspace / brain checkpoints stay rewind machinery. The stored leaf is
 * lexical metadata (id, label, session, files, recipe ids) so fusion can
 * retrieve “the turn that changed src/auth.ts”. Inject is `checkpoint_id=…`
 * only — never snapshot JSON, blob trees, or file bytes.
 */

export const CHECKPOINT_POINTER_KIND = "checkpoint";
export const CHECKPOINT_LEAF_FILE_CAP = 200;
export const CHECKPOINT_LEAF_RECIPE_CAP = 16;
export const CHECKPOINT_INJECT_LABEL_CAP = 80;

export interface CheckpointPointerLeaf {
  workspaceCheckpointId: string;
  memoryCheckpointId?: number;
  label?: string;
  sessionId?: string;
  files: string[];
  recipeIds: string[];
}

export function normalizeCheckpointPaths(files?: readonly string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of files ?? []) {
    const path = raw.replace(/\\/g, "/").trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    unique.push(path);
    if (unique.length >= CHECKPOINT_LEAF_FILE_CAP) break;
  }
  return unique;
}

export function normalizeCheckpointRecipeIds(ids?: readonly string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids ?? []) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
    if (unique.length >= CHECKPOINT_LEAF_RECIPE_CAP) break;
  }
  return unique;
}

export function mergeCheckpointIds(
  current: readonly string[] | undefined,
  incoming: readonly string[] | undefined,
  cap: number,
): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...(current ?? []), ...(incoming ?? [])]) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
    if (unique.length >= cap) break;
  }
  return unique;
}

function compactLabel(label?: string): string {
  const text = (label ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > CHECKPOINT_INJECT_LABEL_CAP
    ? `${text.slice(0, CHECKPOINT_INJECT_LABEL_CAP - 1)}…`
    : text;
}

function asRecord(metadata: unknown): Record<string, unknown> {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  if (typeof metadata === "string" && metadata.trim()) {
    try {
      const parsed = JSON.parse(metadata) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function parseListedField(content: string, label: string): string[] {
  const match = content.match(new RegExp(`^${label}:\\s*(.+)$`, "m"));
  const raw = match?.[1]?.trim() ?? "";
  if (!raw || raw === "(no paths recorded)") return [];
  return raw.split(",").map((part) => part.trim()).filter(Boolean);
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Stored leaf: compact lexical metadata. Paths stay so BM25 / ripgrep can
 * find the turn. No snapshot JSON, hashes, or file bytes.
 */
export function formatCheckpointMetadataLeaf(input: {
  workspaceCheckpointId: string;
  memoryCheckpointId?: number;
  label?: string;
  sessionId?: string;
  files?: readonly string[];
  recipeIds?: readonly string[];
}): string {
  const files = normalizeCheckpointPaths(input.files);
  const recipes = normalizeCheckpointRecipeIds(input.recipeIds);
  const lines = [`checkpoint_id=${input.workspaceCheckpointId.trim()}`];
  if (input.memoryCheckpointId && input.memoryCheckpointId > 0) {
    // Short field on purpose: `auth` + newline + `memory_checkpoint_id` looks
    // like a credential to InputSanitizer (`auth <20+ token chars>`).
    lines.push(`brain_cp=${input.memoryCheckpointId}`);
  }
  if (input.sessionId?.trim()) {
    lines.push(`session=${input.sessionId.trim()}`);
  }
  const label = compactLabel(input.label);
  if (label) lines.push(`label: ${label}`);
  lines.push(
    files.length > 0
      ? `turn that changed: ${files.join(", ")}`
      : "turn that changed: (no paths recorded)",
  );
  if (recipes.length > 0) {
    lines.push(`recipes: ${recipes.join(", ")}`);
  }
  return lines.join("\n");
}

/** Prompt line: pointer only. Never the tree or snapshot JSON. */
export function formatCheckpointInjectPointer(input: {
  cite: string;
  workspaceCheckpointId: string;
  label?: string;
}): string {
  const id = input.workspaceCheckpointId.trim();
  const label = compactLabel(input.label);
  return label
    ? `${input.cite} checkpoint_id=${id} ${label}`
    : `${input.cite} checkpoint_id=${id}`;
}

export function parseCheckpointPointerLeaf(
  content: string,
  metadata?: unknown,
): CheckpointPointerLeaf | undefined {
  const meta = asRecord(metadata);
  const fromMeta = typeof meta.workspaceCheckpointId === "string"
    ? meta.workspaceCheckpointId.trim()
    : "";
  const fromContent = content.match(/(?:^|\s)checkpoint_id=([^\s\n]+)/)?.[1] ?? "";
  const workspaceCheckpointId = fromMeta || fromContent;
  if (!workspaceCheckpointId) return undefined;

  const memoryRaw = meta.memoryCheckpointId;
  const memoryCheckpointId =
    typeof memoryRaw === "number" && memoryRaw > 0
      ? memoryRaw
      : Number(content.match(/(?:brain_cp|memory_checkpoint_id)=(\d+)/)?.[1] ?? 0) || undefined;

  const sessionFromMeta = typeof meta.sessionId === "string" ? meta.sessionId.trim() : "";
  const sessionFromContent = content.match(/^session=(\S+)/m)?.[1] ?? "";
  const labelFromMeta = typeof meta.label === "string" ? meta.label : "";
  const labelFromContent = content.match(/^label:\s*(.+)$/m)?.[1] ?? "";

  return {
    workspaceCheckpointId,
    memoryCheckpointId,
    label: compactLabel(labelFromMeta || labelFromContent) || undefined,
    sessionId: sessionFromMeta || sessionFromContent || undefined,
    files: normalizeCheckpointPaths(
      asStringList(meta.files).length > 0
        ? asStringList(meta.files)
        : parseListedField(content, "turn that changed"),
    ),
    recipeIds: normalizeCheckpointRecipeIds(
      asStringList(meta.recipeIds).length > 0
        ? asStringList(meta.recipeIds)
        : parseListedField(content, "recipes"),
    ),
  };
}

export function isCheckpointPointerLeaf(content: string, metadata?: unknown): boolean {
  const meta = asRecord(metadata);
  if (meta.kind === CHECKPOINT_POINTER_KIND || meta.pointer === true) {
    return Boolean(parseCheckpointPointerLeaf(content, metadata));
  }
  const trimmed = content.trim();
  return trimmed.startsWith("checkpoint_id=");
}

export function checkpointPointerMetadata(input: {
  workspaceCheckpointId: string;
  memoryCheckpointId?: number;
  label?: string;
  sessionId?: string;
  files?: readonly string[];
  recipeIds?: readonly string[];
}): Record<string, unknown> {
  return {
    soul: true,
    kind: CHECKPOINT_POINTER_KIND,
    pointer: true,
    workspaceCheckpointId: input.workspaceCheckpointId.trim(),
    ...(input.memoryCheckpointId && input.memoryCheckpointId > 0
      ? { memoryCheckpointId: input.memoryCheckpointId }
      : {}),
    ...(input.sessionId?.trim() ? { sessionId: input.sessionId.trim() } : {}),
    ...(compactLabel(input.label) ? { label: compactLabel(input.label) } : {}),
    files: normalizeCheckpointPaths(input.files),
    recipeIds: normalizeCheckpointRecipeIds(input.recipeIds),
  };
}

export function looksLikeCheckpointDump(text: string): boolean {
  if (!text) return false;
  if (/"semantic"\s*:/.test(text) && /"snapshot_path"\s*:/.test(text)) return true;
  if (/fileSnapshots/.test(text) && /"hash"\s*:/.test(text) && /"content"\s*:/.test(text)) {
    return true;
  }
  return false;
}
