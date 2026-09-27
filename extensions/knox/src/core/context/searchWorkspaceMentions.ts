import {
  ContextSubmenuItem,
  IDE,
} from "../index.js";
import {
  getShortestUniqueRelativeUriPaths,
  getUriPathBasename,
} from "../util/uri.js";
import { walkDir } from "../util/walkDir.js";

const LIVE_FILE_WALK_CAP = 10_000;

export const LIVE_FILE_SEARCH_CAP = 200;

export function mentionUriMatchesQuery(
  title: string,
  description: string,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) {
    return false;
  }
  return (
    title.toLowerCase().includes(q) || description.toLowerCase().includes(q)
  );
}

export function rankLiveMentionHits<
  T extends { title: string; description: string },
>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return [...items].sort((a, b) => {
    const aTitle = a.title.toLowerCase();
    const bTitle = b.title.toLowerCase();
    const aExact = aTitle === q;
    const bExact = bTitle === q;
    if (aExact !== bExact) {
      return aExact ? -1 : 1;
    }
    const aPrefix = aTitle.startsWith(q);
    const bPrefix = bTitle.startsWith(q);
    if (aPrefix !== bPrefix) {
      return aPrefix ? -1 : 1;
    }
    return aTitle.length - bTitle.length || a.title.localeCompare(b.title);
  });
}

/**
 * Walk workspace files/folders and return query matches (cap 200).
 * Used when MiniSearch has few hits — new files, truncated indexes.
 */
export async function searchWorkspaceMentions(
  ide: IDE,
  query: string,
  limit: number = LIVE_FILE_SEARCH_CAP,
): Promise<ContextSubmenuItem[]> {
  const q = query.trim();
  if (q.length < 2) {
    return [];
  }

  const workspaceDirs = await ide.getWorkspaceDirs();
  if (workspaceDirs.length === 0) {
    return [];
  }

  const walked = await Promise.all(
    workspaceDirs.map(async (dir) => {
      const [files, mixed] = await Promise.all([
        walkDir(dir, ide, {
          source: "mention-live-file",
          includeDirs: false,
          workspaceDirs,
          maxEntries: LIVE_FILE_WALK_CAP,
        }),
        walkDir(dir, ide, {
          source: "mention-live-folder",
          includeDirs: true,
          workspaceDirs,
          maxEntries: LIVE_FILE_WALK_CAP,
        }),
      ]);
      const fileSet = new Set(files);
      const folders = mixed.filter((uri) => !fileSet.has(uri));
      return { files, folders };
    }),
  );

  const files = walked.flatMap((part) => part.files);
  const folders = walked.flatMap((part) => part.folders);
  const folderSet = new Set(folders);
  const withUniquePaths = getShortestUniqueRelativeUriPaths(
    [...files, ...folders],
    workspaceDirs,
  );

  const matched = withUniquePaths.filter((item) =>
    mentionUriMatchesQuery(
      getUriPathBasename(item.uri),
      item.uniquePath,
      q,
    ),
  );

  const items: ContextSubmenuItem[] = matched.map((item) => ({
    id: item.uri,
    title: getUriPathBasename(item.uri),
    description: item.uniquePath,
    icon: folderSet.has(item.uri) ? "folder" : "file",
  }));

  return rankLiveMentionHits(items, q).slice(0, limit);
}
