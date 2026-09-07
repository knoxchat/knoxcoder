import { fileURLToPath } from "node:url";

import { t } from "../../i18n/index.js";

import { ToolImpl } from ".";

export const MAX_GIT_LOG_COUNT = 50;
export const DEFAULT_GIT_LOG_COUNT = 20;
export const MAX_GIT_BLAME_LINES = 200;
export const HARD_GIT_BLAME_LINES = 1000;

function toFsPath(uriOrPath: string): string {
  if (uriOrPath.startsWith("file://")) {
    return fileURLToPath(uriOrPath);
  }
  return uriOrPath;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function resolveGitCwd(
  extras: Parameters<ToolImpl>[1],
): Promise<string> {
  const dirs = await extras.ide.getWorkspaceDirs();
  if (!dirs.length) {
    throw new Error(t("gitNoWorkspace"));
  }
  const root = dirs[0];
  const gitRoot = extras.ide.getGitRootPath
    ? await extras.ide.getGitRootPath(root)
    : undefined;
  return toFsPath(gitRoot || root);
}

export async function runGit(
  extras: Parameters<ToolImpl>[1],
  args: string[],
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  const cwd = await resolveGitCwd(extras);
  const command = ["git", ...args].join(" ");
  try {
    const [stdout, stderr] = await extras.ide.subprocess(command, cwd);
    return { stdout: stdout ?? "", stderr: stderr ?? "", ok: true };
  } catch (error) {
    const stderr = typeof error === "string" ? error : (error as Error).message;
    return { stdout: "", stderr, ok: false };
  }
}

export function formatGitResult(
  title: string,
  result: { stdout: string; stderr: string; ok: boolean },
): string {
  const parts = [
    result.stdout.trim() || "(empty)",
    result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : "",
    result.ok ? "" : "git exited with an error.",
  ].filter(Boolean);
  return `${title}\n\n${parts.join("\n\n")}`;
}

export function capLines(
  text: string,
  max: number,
  footer: string,
): string {
  const trimmed = text.replace(/\n+$/, "");
  if (!trimmed) {
    return text;
  }
  const lines = trimmed.split(/\r?\n/);
  if (lines.length <= max) {
    return trimmed;
  }
  return `${lines.slice(0, max).join("\n")}\n\n${footer}`;
}

function clampCount(raw: unknown, fallback: number, max: number): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.min(Math.floor(raw), max);
  }
  return fallback;
}

function stringArg(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export const gitStatusImpl: ToolImpl = async (_args, extras) => {
  const result = await runGit(extras, ["status", "--porcelain=v1", "-b"]);
  return [
    {
      name: "git status",
      description: result.ok ? "git status" : "git status failed",
      content: formatGitResult("git status --porcelain=v1 -b", result),
    },
  ];
};

export const gitDiffImpl: ToolImpl = async (args, extras) => {
  const pathspec =
    typeof args.path === "string" && args.path.trim()
      ? ["--", args.path.trim()]
      : [];
  const chunks: string[] = [];

  if (args.both === true || args.staged !== true) {
    const unstaged = await runGit(extras, ["diff", "--", ...pathspec.slice(1)]);
    chunks.push(formatGitResult("git diff (unstaged)", unstaged));
  }
  if (args.both === true || args.staged === true) {
    const staged = await runGit(extras, [
      "diff",
      "--cached",
      ...pathspec,
    ]);
    chunks.push(formatGitResult("git diff --cached (staged)", staged));
  }

  return [
    {
      name: "git diff",
      description: "git diff",
      content: chunks.join("\n\n---\n\n"),
    },
  ];
};

export const gitLogImpl: ToolImpl = async (args, extras) => {
  const count = clampCount(
    args.max_count ?? args.maxCount,
    DEFAULT_GIT_LOG_COUNT,
    MAX_GIT_LOG_COUNT,
  );
  const pathspec =
    typeof args.path === "string" && args.path.trim()
      ? ["--", args.path.trim()]
      : [];
  const pickaxe = stringArg(args.search, args.pickaxe, args.S);
  const regex = stringArg(args.regex, args.G);
  const gitArgs = ["log", `-n${count}`, "--oneline", "--decorate"];
  if (pickaxe && regex) {
    return [
      {
        name: "git log",
        description: "invalid pickaxe",
        content:
          "Pass search (-S, pickaxe string) or regex (-G), not both.",
      },
    ];
  }
  if (pickaxe) {
    gitArgs.push(`-S${shellQuote(pickaxe)}`);
  }
  if (regex) {
    gitArgs.push(`-G${shellQuote(regex)}`);
  }
  if (args.all === true) {
    gitArgs.push("--all");
  }
  gitArgs.push(...pathspec);
  const result = await runGit(extras, gitArgs);
  const title = [
    `git log -n${count} --oneline`,
    pickaxe ? `-S ${pickaxe}` : "",
    regex ? `-G ${regex}` : "",
    args.all === true ? "--all" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return [
    {
      name: "git log",
      description: result.ok
        ? pickaxe || regex
          ? `pickaxe last ${count}`
          : `last ${count}`
        : "git log failed",
      content: formatGitResult(title, result),
    },
  ];
};

export const gitBlameImpl: ToolImpl = async (args, extras) => {
  const file = stringArg(args.filepath, args.file, args.path);
  if (!file) {
    throw new Error(t("missingRequiredParam", { param: "filepath" }));
  }
  const start = clampCount(args.start_line ?? args.startLine, 0, 1_000_000);
  const end = clampCount(args.end_line ?? args.endLine, 0, 1_000_000);
  const maxLines = clampCount(
    args.max_lines ?? args.maxLines,
    MAX_GIT_BLAME_LINES,
    HARD_GIT_BLAME_LINES,
  );
  const gitArgs = ["blame", "--date=short"];
  if (start > 0 && end > 0) {
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    gitArgs.push(`-L${lo},${hi}`);
  } else if (start > 0) {
    gitArgs.push(`-L${start},${start + maxLines - 1}`);
  } else if (end > 0) {
    gitArgs.push(`-L1,${end}`);
  }
  const rev = stringArg(args.rev, args.revision, args.commit);
  if (rev) {
    gitArgs.push(shellQuote(rev));
  }
  gitArgs.push("--", shellQuote(file));
  const result = await runGit(extras, gitArgs);
  const footer = `truncated at ${maxLines} lines; pass start_line/end_line (or max_lines).`;
  const stdout = capLines(result.stdout, maxLines, footer);
  return [
    {
      name: "git blame",
      description: result.ok ? file : "git blame failed",
      content: formatGitResult(`git blame ${file}`, {
        ...result,
        stdout,
      }),
    },
  ];
};

export const gitCommitImpl: ToolImpl = async (args, extras) => {
  const message =
    typeof args.message === "string" ? args.message.trim() : "";
  if (!message) {
    throw new Error(t("missingRequiredParam", { param: "message" }));
  }

  if (args.add_all === true || args.addAll === true) {
    const addAll = await runGit(extras, ["add", "-A"]);
    if (!addAll.ok) {
      return [
        {
          name: "git commit",
          description: "git add -A failed",
          content: formatGitResult("git add -A", addAll),
        },
      ];
    }
  } else if (Array.isArray(args.paths) && args.paths.length) {
    const paths = args.paths.filter(
      (path: unknown): path is string =>
        typeof path === "string" && path.trim().length > 0,
    );
    if (paths.length) {
      const add = await runGit(extras, ["add", "--", ...paths]);
      if (!add.ok) {
        return [
          {
            name: "git commit",
            description: "git add failed",
            content: formatGitResult("git add", add),
          },
        ];
      }
    }
  }

  const result = await runGit(extras, ["commit", "-m", shellQuote(message)]);
  return [
    {
      name: "git commit",
      description: result.ok ? "committed" : "git commit failed",
      content: formatGitResult(`git commit -m ${shellQuote(message)}`, result),
    },
  ];
};
