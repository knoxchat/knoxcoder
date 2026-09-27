/**
 * Rank and summarize a workspace file list for kernel-scale repo maps (HL-20).
 * Directory counts are always cheap; signatures are reserved for hot files.
 */

export interface RankedFile {
  path: string;
  score: number;
}

export interface DirectoryCount {
  dir: string;
  count: number;
}

const KERNEL_TOP = /^(mm|kernel|fs|arch|drivers|net|virt|block|crypto|init|ipc|lib|security|sound|usr|tools|scripts|include)\//;

export function pathBasename(rel: string): string {
  const normalized = rel.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? normalized;
}

export function scoreRepoMapPath(
  rel: string,
  options: {
    query?: string;
    mtime?: number;
    maxMtime?: number;
    gitTouched?: boolean;
  } = {},
): number {
  const path = rel.replace(/\\/g, "/").replace(/^\.\//, "");
  const base = pathBasename(path);
  let score = 0;

  if (base === "MAINTAINERS") {
    score += 100;
  }
  if (/^(Makefile|GNUmakefile|Kbuild)$/i.test(base)) {
    score += 80;
  }
  if (/^Kconfig/i.test(base)) {
    score += 80;
  }
  if (base === "meson.build" || base === "CMakeLists.txt" || base === "configure") {
    score += 40;
  }
  if (KERNEL_TOP.test(path)) {
    score += 15;
  }
  if (/\.(c|h|cc|cpp|S|s|dts|dtsi|lds)$/i.test(base)) {
    score += 8;
  }
  if (options.gitTouched) {
    score += 45;
  }
  if (options.query) {
    const needle = options.query.toLowerCase().replace(/\\/g, "/");
    if (needle && path.toLowerCase().includes(needle)) {
      score += 40;
    }
  }
  if (
    options.mtime &&
    options.maxMtime &&
    options.maxMtime > 0 &&
    options.mtime / options.maxMtime > 0.9
  ) {
    score += 50;
  } else if (
    options.mtime &&
    options.maxMtime &&
    options.maxMtime > 0 &&
    options.mtime / options.maxMtime > 0.7
  ) {
    score += 20;
  }
  if (/\.(mod\.c|o|ko|a|cmd)$/i.test(base) || /\/generated\//i.test(path)) {
    score -= 80;
  }
  return score;
}

export function rankRepoMapFiles(
  relativePaths: string[],
  options: {
    query?: string;
    mtimes?: Record<string, number>;
    gitTouched?: Set<string>;
  } = {},
): RankedFile[] {
  let maxMtime = 0;
  if (options.mtimes) {
    for (const value of Object.values(options.mtimes)) {
      if (value > maxMtime) {
        maxMtime = value;
      }
    }
  }
  return relativePaths
    .map((path) => ({
      path,
      score: scoreRepoMapPath(path, {
        query: options.query,
        mtime: options.mtimes?.[path],
        maxMtime,
        gitTouched: options.gitTouched?.has(path),
      }),
    }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

/** Top-level directory file counts (and `arch/x86`-style second level when useful). */
export function directoryCounts(
  relativePaths: string[],
  depth = 1,
): DirectoryCount[] {
  const counts = new Map<string, number>();
  for (const rel of relativePaths) {
    const parts = rel.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length === 0) {
      continue;
    }
    const key =
      parts.length === 1
        ? "(root)"
        : parts.slice(0, Math.min(depth, parts.length - 1)).join("/") + "/";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([dir, count]) => ({ dir, count }))
    .sort((a, b) => b.count - a.count || a.dir.localeCompare(b.dir));
}

export function formatDirectoryMap(
  counts: DirectoryCount[],
  totalFiles: number,
): string {
  if (counts.length === 0) {
    return `## Subsystems\n(no files)\n`;
  }
  const width = Math.max(...counts.map((item) => item.dir.length), 8);
  const lines = counts.map((item) => {
    const dir = item.dir.padEnd(width);
    return `  ${dir}  ${String(item.count).padStart(6)} files`;
  });
  return [`## Subsystems (${totalFiles} files)`, ...lines, ""].join("\n");
}
