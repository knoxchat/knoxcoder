/**
 * Minimal real-disk IDE for headless runs (K-029).
 *
 * Implements only what the headless tool catalog (read, edit, write, patch,
 * shell, search, glob, directory view) calls. Everything else is a no-op or
 * throws, so a tool that needs an editor fails loudly instead of silently.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { IDE } from "..";
import type { SearchOptions } from "../protocol/ide";
import { formatSearchTruncationNotice } from "../tools/ripgrep";

const SKIP_DIRS = new Set([".git", "node_modules", "target", "dist", ".venv"]);
const MAX_SEARCH_FILE_BYTES = 2_000_000;

const toPath = (uri: string): string =>
  uri.startsWith("file:") ? fileURLToPath(uri) : uri;

async function* walk(root: string): AsyncGenerator<string> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        yield* walk(path.join(root, entry.name));
      }
    } else if (entry.isFile()) {
      yield path.join(root, entry.name);
    }
  }
}

export function createNodeIde(workspaceDir: string): IDE {
  const root = path.resolve(workspaceDir);
  const rootUri = pathToFileURL(root).href;

  const ide = {
    getWorkspaceDirs: async () => [rootUri],
    getCurrentFile: async () => undefined,
    getIdeInfo: async () => ({ remoteName: "local" }),
    getGitRootPath: async () => rootUri,
    fileExists: async (uri: string) => {
      try {
        await fs.access(toPath(uri));
        return true;
      } catch {
        return false;
      }
    },
    listDir: async (uri: string): Promise<[string, number][]> => {
      const entries = await fs.readdir(toPath(uri), { withFileTypes: true });
      return entries
        .map((e): [string, number] => [e.name, e.isDirectory() ? 2 : 1])
        .sort((a, b) => a[0].localeCompare(b[0]));
    },
    readFile: async (uri: string) => fs.readFile(toPath(uri), "utf-8"),
    readRangeInFile: async (
      uri: string,
      range: { start: { line: number }; end: { line: number } },
    ) => {
      const lines = (await fs.readFile(toPath(uri), "utf-8")).split("\n");
      return lines.slice(range.start.line, range.end.line + 1).join("\n");
    },
    writeFile: async (uri: string, contents: string) => {
      const file = toPath(uri);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, contents, "utf-8");
    },
    removeFile: async (uri: string) => {
      await fs.rm(toPath(uri), { force: true });
    },
    getFileStats: async (uris: string[]) => {
      const out: Record<string, unknown> = {};
      for (const uri of uris) {
        try {
          const s = await fs.stat(toPath(uri));
          out[uri] = {
            lastModified: s.mtimeMs,
            size: s.size,
            type: s.isDirectory() ? 2 : 1,
          };
        } catch {
          // skip missing
        }
      }
      return out;
    },
    getSearchResults: async (query: string, options?: SearchOptions) => {
      const max = options?.maxResults ?? 50;
      let regex: RegExp;
      try {
        regex = new RegExp(
          options?.fixedStrings === false || options?.pcre2 === true
            ? query
            : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          options?.caseSensitive ? "" : "i",
        );
      } catch {
        return `Search error: invalid pattern ${query}`;
      }
      const base = options?.path
        ? path.resolve(root, options.path)
        : root;
      const hits: string[] = [];
      for await (const file of walk(base)) {
        const rel = path.relative(root, file).split(path.sep).join("/");
        let text: string;
        try {
          const stat = await fs.stat(file);
          if (stat.size > MAX_SEARCH_FILE_BYTES) {
            continue;
          }
          text = await fs.readFile(file, "utf-8");
        } catch {
          continue;
        }
        if (text.includes("\0")) {
          continue;
        }
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            hits.push(`${rel}:${i + 1}:${lines[i]}`);
            if (hits.length >= max) {
              hits.push(formatSearchTruncationNotice(max));
              return hits.join("\n");
            }
          }
        }
      }
      return hits.join("\n") || "No matches found";
    },
    subprocess: (command: string, cwd?: string): Promise<[string, string]> =>
      new Promise((resolve) => {
        execFile(
          "/bin/sh",
          ["-c", command],
          { cwd: cwd ? toPath(cwd) : root, maxBuffer: 10_000_000 },
          (_error, stdout, stderr) => resolve([stdout, stderr]),
        );
      }),
    getDiff: async () => [],
    openFile: async () => {},
    runCommand: async () => {},
  } as unknown as IDE;
  return ide;
}
