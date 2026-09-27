import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { FileStatsMap, IDE, ILLM, SymbolWithRange } from "..";
import { pruneLinesFromTop } from "../llm/countTokens";

import { getRepoMapFilePath } from "./paths";
import {
  readRepoMapCache,
  repoMapCacheKey,
  repoMapFingerprint,
  writeRepoMapCache,
} from "./repoMapCache";
import {
  directoryCounts,
  formatDirectoryMap,
  rankRepoMapFiles,
} from "./repoMapRank";
import { getSymbolsForFile, supportedLanguages } from "./treeSitter";
import { getSystemsFallbackSignatures } from "./systemsSignatures";
import { findUriInDirs, getUriFileExtension, joinPathsToUri } from "./uri";
import { walkDir } from "./walkDir";

export interface RepoMapOptions {
  includeSignatures?: boolean;
  dirUris?: string[];
  outputRelativeUriPaths: boolean;
  /** Workspace-relative subdirectory (e.g. `mm/`). */
  path?: string;
  /** Boost files whose path contains this query. */
  query?: string;
  /** Skip ~/.knox/repo-map disk cache. */
  skipCache?: boolean;
}

/** Max signature lines kept per file (keeps the map readable + under budget). */
const MAX_SIGNATURES_PER_FILE = 40;
/** Tree-sitter only the hottest files so a kernel tree cannot stall. */
export const MAX_SIGNATURE_FILES = 80;

/** First-line signature text from a tree-sitter symbol. */
export function formatSymbolSignature(symbol: SymbolWithRange): string {
  const firstLine = symbol.content.split("\n")[0]?.trim() ?? symbol.name;
  // Prefer the real declaration line; fall back to type + name.
  if (firstLine && firstLine.length > 0) {
    return firstLine.length > 160 ? firstLine.slice(0, 157) + "…" : firstLine;
  }
  return `${symbol.type} ${symbol.name}`;
}

export function formatFileEntry(
  displayPath: string,
  signatures: string[],
): string {
  if (signatures.length === 0) {
    return `${displayPath}\n`;
  }
  return `${displayPath}:\n${signatures.map((s) => `\t${s}`).join("\n")}\n`;
}

function languageSupportedForUri(uri: string): boolean {
  const ext = getUriFileExtension(uri);
  return Boolean(supportedLanguages[ext]);
}

function uriToFsPath(uri: string): string {
  if (uri.startsWith("file://")) {
    try {
      return fileURLToPath(uri);
    } catch {
      return uri.replace(/^file:\/\//, "");
    }
  }
  return uri;
}

class RepoMapGenerator {
  private maxRepoMapTokens: number;

  private repoMapPath: string = getRepoMapFilePath();
  private writeStream: fs.WriteStream | undefined;
  private contentTokens: number = 0;
  private dirs: string[] = [];
  private allUris: string[] = [];
  private budgetExceeded = false;

  private REPO_MAX_CONTEXT_LENGTH_RATIO = 0.5;
  private PREAMBLE_WITH_SIGNATURES =
    "Below is a repository map.\n" +
    "Directory counts are listed first so subsystem structure survives the token budget. " +
    "Signatures follow for the highest-ranked files (MAINTAINERS, Makefile, Kconfig, recently touched, query matches).\n" +
    "Pass path (e.g. mm/) on builtin_view_repo_map to zoom in.\n\n";
  private PREAMBLE_PATHS_ONLY =
    "Below is a repository map listing subsystems and files in the codebase.\n\n";

  constructor(
    private llm: ILLM,
    private ide: IDE,
    private options: RepoMapOptions,
  ) {
    this.maxRepoMapTokens =
      llm.contextLength * this.REPO_MAX_CONTEXT_LENGTH_RATIO;
  }

  private getUriForWrite(uri: string) {
    if (this.options.outputRelativeUriPaths) {
      return findUriInDirs(uri, this.dirs).relativePathOrBasename;
    }
    return uri;
  }

  /**
   * Extract declaration signatures for a file via tree-sitter.
   * Returns null when the language is unsupported (caller should list path only).
   */
  async getSignaturesForUri(uri: string): Promise<string[] | null> {
    let contents: string;
    try {
      contents = await this.ide.readFile(uri);
    } catch {
      return null;
    }

    const fallback = getSystemsFallbackSignatures(uri, contents);
    if (fallback.length > 0) {
      return fallback.slice(0, MAX_SIGNATURES_PER_FILE);
    }

    if (!languageSupportedForUri(uri)) {
      return null;
    }

    try {
      const symbols = await getSymbolsForFile(uri, contents);
      if (!symbols || symbols.length === 0) {
        return [];
      }
      return symbols
        .slice(0, MAX_SIGNATURES_PER_FILE)
        .map(formatSymbolSignature);
    } catch (e) {
      console.debug(`[RepoMap] Failed to extract signatures for ${uri}:`, e);
      return [];
    }
  }

  private async resolveDirs(): Promise<string[]> {
    const workspace = await this.ide.getWorkspaceDirs();
    const pathArg = this.options.path?.trim().replace(/\\/g, "/");
    if (pathArg && pathArg !== "." && workspace[0]) {
      return [joinPathsToUri(workspace[0], pathArg.replace(/^\.\//, ""))];
    }
    return this.options.dirUris ?? workspace;
  }

  private async recentlyGitTouched(dirUri: string): Promise<Set<string>> {
    if (typeof this.ide.subprocess !== "function") {
      return new Set();
    }
    try {
      const cwd = uriToFsPath(dirUri);
      const [stdout] = await this.ide.subprocess(
        "git log -n 80 --name-only --pretty=format:",
        cwd,
      );
      return new Set(
        stdout
          .split(/\r?\n/)
          .map((line) => line.trim().replace(/\\/g, "/"))
          .filter((line) => line && !line.startsWith("commit ")),
      );
    } catch {
      return new Set();
    }
  }

  private async mtimesFor(uris: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    if (typeof this.ide.getFileStats !== "function" || uris.length === 0) {
      return out;
    }
    const batchSize = 400;
    for (let i = 0; i < uris.length; i += batchSize) {
      const batch = uris.slice(i, i + batchSize);
      try {
        const stats: FileStatsMap = await this.ide.getFileStats(batch);
        for (const [uri, stat] of Object.entries(stats ?? {})) {
          if (stat?.lastModified) {
            out[uri] = stat.lastModified;
          }
        }
      } catch {
        // Ranking still works without mtimes.
      }
    }
    return out;
  }

  async generate(): Promise<string> {
    const workspaceDirs = await this.ide.getWorkspaceDirs();
    this.dirs = await this.resolveDirs();
    this.allUris = [];
    for (const dir of this.dirs) {
      const uris = await walkDir(dir, this.ide, {
        source: "generate repo map",
        workspaceDirs,
      });
      this.allUris.push(...uris);
    }

    const relativePaths = this.allUris.map((uri) => this.getUriForWrite(uri));
    const uriByRel = new Map<string, string>();
    for (let i = 0; i < this.allUris.length; i++) {
      uriByRel.set(relativePaths[i], this.allUris[i]);
    }
    const cacheKey = repoMapCacheKey({
      workspaceDirs: this.dirs,
      path: this.options.path,
      includeSignatures: this.options.includeSignatures,
      query: this.options.query,
    });
    const uriMtimes = await this.mtimesFor(this.allUris);
    const relMtimes: Record<string, number> = {};
    for (let i = 0; i < this.allUris.length; i++) {
      const mtime = uriMtimes[this.allUris[i]];
      if (mtime) {
        relMtimes[relativePaths[i]] = mtime;
      }
    }
    const fingerprint = repoMapFingerprint(this.allUris, uriMtimes);

    if (!this.options.skipCache) {
      const cached = readRepoMapCache(cacheKey);
      if (cached?.fingerprint === fingerprint) {
        try {
          fs.writeFileSync(this.repoMapPath, cached.content);
        } catch {
          // Best-effort copy for the legacy repo_map.txt path.
        }
        return cached.content;
      }
    }

    const gitTouched = new Set<string>();
    for (const dir of this.dirs) {
      const touched = await this.recentlyGitTouched(dir);
      for (const item of touched) {
        gitTouched.add(item);
      }
    }

    const ranked = rankRepoMapFiles(relativePaths, {
      query: this.options.query,
      mtimes: relMtimes,
      gitTouched,
    });
    const counts = directoryCounts(relativePaths, 1);
    const dirMap = formatDirectoryMap(counts, relativePaths.length);

    const wantSignatures = Boolean(this.options.includeSignatures);
    await this.writeToStream(
      wantSignatures
        ? this.PREAMBLE_WITH_SIGNATURES
        : this.PREAMBLE_PATHS_ONLY,
    );
    await this.writeToStream(dirMap);

    if (wantSignatures) {
      const hot = ranked.slice(0, MAX_SIGNATURE_FILES);
      const hotSet = new Set(hot.map((item) => item.path));
      for (const item of hot) {
        if (this.budgetExceeded) {
          break;
        }
        const uri = uriByRel.get(item.path);
        if (!uri) {
          continue;
        }
        const signatures = await this.getSignaturesForUri(uri);
        const entry = formatFileEntry(
          item.path,
          signatures === null ? [] : signatures,
        );
        await this.writeToStream(entry + "\n");
      }

      const remainder = relativePaths.filter((p) => !hotSet.has(p));
      if (remainder.length > 0 && !this.budgetExceeded) {
        await this.writeToStream(
          `\n# Other files (${remainder.length}; omitted signatures)\n` +
            remainder.join("\n") +
            "\n",
        );
      } else if (this.budgetExceeded) {
        await this.appendTruncationNotice(remainder.length);
      }
    } else {
      const pinned = ranked.slice(0, 24).map((item) => item.path);
      const pinnedSet = new Set(pinned);
      await this.writeToStream(`## Pinned\n${pinned.join("\n")}\n\n`);
      const remainder = relativePaths.filter((p) => !pinnedSet.has(p));
      if (remainder.length > 0 && !this.budgetExceeded) {
        await this.writeToStream(remainder.join("\n") + "\n");
      }
    }

    if (this.budgetExceeded) {
      console.debug(
        "Full repo map was unable to be generated due to context window limitations",
      );
    }

    const content = await this.endStream();
    if (!this.options.skipCache) {
      writeRepoMapCache(cacheKey, { version: 1, fingerprint, content });
    }
    return content;
  }

  private async appendTruncationNotice(omitted: number): Promise<void> {
    const pathHint = this.options.path
      ? ` Already scoped to ${this.options.path}.`
      : ` Pass path (e.g. "mm/") on builtin_view_repo_map to zoom in.`;
    await this.writeToStream(
      `\n[truncated: omitted ${omitted} files.${pathHint}]\n`,
    );
  }

  private ensureStream(): fs.WriteStream {
    if (!this.writeStream) {
      this.writeStream = fs.createWriteStream(this.repoMapPath);
    }
    return this.writeStream;
  }

  private endStream(): Promise<string> {
    const stream = this.writeStream;
    this.writeStream = undefined;
    if (!stream) {
      try {
        return Promise.resolve(fs.readFileSync(this.repoMapPath, "utf8"));
      } catch {
        return Promise.resolve("");
      }
    }
    return new Promise((resolve) => {
      stream.end(() => {
        try {
          resolve(fs.readFileSync(this.repoMapPath, "utf8"));
        } catch {
          resolve("");
        }
      });
    });
  }

  private async writeToStream(content: string): Promise<void> {
    if (this.budgetExceeded) return;

    const tokens = this.llm.countTokens(content);

    if (this.contentTokens + tokens > this.maxRepoMapTokens) {
      content = pruneLinesFromTop(
        content,
        this.maxRepoMapTokens - this.contentTokens,
        this.llm.model,
      );
      this.budgetExceeded = true;
    }

    this.contentTokens += this.llm.countTokens(content);

    const stream = this.ensureStream();
    await new Promise((resolve) => stream.write(content, resolve));
  }
}

export default async function generateRepoMap(
  llm: ILLM,
  ide: IDE,
  options: RepoMapOptions,
): Promise<string> {
  const generator = new RepoMapGenerator(llm, ide, options);
  return generator.generate();
}
