export const CHECKPOINT_LIST_PAGE_SIZE = 50;
export const CHANGED_PATHS_INDEX_LIMIT = 200;
export const COMPARE_CATALOG_LIMIT = 1000;

export interface CheckpointListQuery {
    query?: string;
    offset?: number;
    limit?: number;
    sessionId?: string;
    thisSessionOnly?: boolean;
}

export interface CheckpointSearchFields {
    id: string;
    description?: string;
    tags?: string[];
    sessionId?: string;
    conversationContext?: { sessionId?: string; role?: string };
    changedPaths?: string[];
    fileSnapshots?: Array<{ relativePath?: string }>;
    fileInventory?: string[];
}

export interface Paginated<T> {
    items: T[];
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
}

export function changedPathsFromSnapshots(
    snapshots?: Array<{ relativePath?: string }>,
): string[] {
    if (!snapshots?.length) {
        return [];
    }
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const snapshot of snapshots) {
        const relativePath = (snapshot.relativePath ?? "").replace(/\\/g, "/").trim();
        if (!relativePath || seen.has(relativePath)) {
            continue;
        }
        seen.add(relativePath);
        unique.push(relativePath);
        if (unique.length >= CHANGED_PATHS_INDEX_LIMIT) {
            break;
        }
    }
    return unique;
}

export function searchablePaths(checkpoint: CheckpointSearchFields): string[] {
    if (checkpoint.changedPaths?.length) {
        return checkpoint.changedPaths.slice(0, CHANGED_PATHS_INDEX_LIMIT);
    }
    const fromSnapshots = changedPathsFromSnapshots(checkpoint.fileSnapshots);
    if (fromSnapshots.length) {
        return fromSnapshots;
    }
    return changedPathsFromSnapshots(
        (checkpoint.fileInventory ?? []).map((relativePath) => ({ relativePath })),
    );
}

export function checkpointSessionId(checkpoint: CheckpointSearchFields): string | undefined {
    return checkpoint.sessionId ?? checkpoint.conversationContext?.sessionId;
}

export function isListableCheckpoint(checkpoint: CheckpointSearchFields & { description?: string }): boolean {
    if (checkpoint.conversationContext?.role === "user") {
        return false;
    }
    if (checkpoint.description?.startsWith("User query at index")) {
        return false;
    }
    return true;
}

export function checkpointMatchesQuery(checkpoint: CheckpointSearchFields, query?: string): boolean {
    const needle = query?.trim().toLowerCase();
    if (!needle) {
        return true;
    }
    if (checkpoint.id.toLowerCase().includes(needle)) {
        return true;
    }
    if ((checkpoint.description ?? "").toLowerCase().includes(needle)) {
        return true;
    }
    if (checkpoint.tags?.some((tag) => tag.toLowerCase().includes(needle))) {
        return true;
    }
    const sessionId = checkpointSessionId(checkpoint);
    if (sessionId?.toLowerCase().includes(needle)) {
        return true;
    }
    if (searchablePaths(checkpoint).some((path) => path.toLowerCase().includes(needle))) {
        return true;
    }
    return false;
}

export function checkpointMatchesSession(
    checkpoint: CheckpointSearchFields,
    sessionId: string | undefined,
    thisSessionOnly: boolean | undefined,
): boolean {
    if (!thisSessionOnly || !sessionId) {
        return true;
    }
    const owner = checkpointSessionId(checkpoint);
    return !owner || owner === sessionId;
}

export function paginateItems<T>(
    items: T[],
    offset = 0,
    limit = CHECKPOINT_LIST_PAGE_SIZE,
): Paginated<T> {
    const start = Math.max(0, Math.trunc(offset) || 0);
    const size = limit > 0 ? Math.trunc(limit) : CHECKPOINT_LIST_PAGE_SIZE;
    const page = items.slice(start, start + size);
    return {
        items: page,
        total: items.length,
        offset: start,
        limit: size,
        hasMore: start + page.length < items.length,
    };
}

export function selectIdRange(orderedIds: string[], fromId: string, toId: string): string[] {
    const startIndex = orderedIds.indexOf(fromId);
    const endIndex = orderedIds.indexOf(toId);
    if (startIndex < 0 && endIndex < 0) {
        return [];
    }
    if (startIndex < 0) {
        return [toId];
    }
    if (endIndex < 0) {
        return [fromId];
    }
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);
    return orderedIds.slice(start, end + 1);
}
