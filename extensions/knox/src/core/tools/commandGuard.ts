/**
 * Shell-aware destructive-command detection.
 *
 * Instead of matching only the start of the command string, split it into
 * simple commands (pipes, `&&`, `||`, `;`, newlines, `$(...)`, backticks,
 * `sh -c '...'`), strip env-var prefixes and wrappers (`sudo`, `env`,
 * `command`, `nohup`, `time`), then test each simple command.
 */

const WRAPPERS = new Set([
  "sudo",
  "doas",
  "env",
  "command",
  "nohup",
  "time",
  "nice",
  "exec",
  "builtin",
]);

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);

/** Split on unquoted control operators. Quotes are respected. */
function splitTopLevel(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      cur += ch;
      if (ch === "\\" && quote === '"' && i + 1 < input.length) {
        cur += input[++i];
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "\\" && i + 1 < input.length) {
      cur += ch + input[++i];
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === ";" || ch === "\n" || ch === "|" || ch === "&") {
      // `>&2`, `2>&1`, `&>` are redirections, not separators.
      if (ch === "&" && (input[i - 1] === ">" || input[i + 1] === ">")) {
        cur += ch;
        continue;
      }
      if ((ch === "|" || ch === "&") && input[i + 1] === ch) {
        i++;
      }
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment))) {
    tokens.push(m[1] ?? m[2] ?? m[3]);
  }
  return tokens;
}

/** Inner commands from `$(...)`, backticks, and `(...)` subshells. */
function extractSubstitutions(input: string): string[] {
  const out: string[] = [];
  for (const m of input.matchAll(/\$\(([^()]*)\)/g)) {
    out.push(m[1]);
  }
  for (const m of input.matchAll(/`([^`]*)`/g)) {
    out.push(m[1]);
  }
  return out;
}

/**
 * Flatten a command line into simple commands (each a token list with env
 * prefixes and wrappers removed). `sh -c "<script>"` is expanded recursively.
 */
export function splitShellCommands(command: string, depth = 0): string[][] {
  if (depth > 4 || !command.trim()) {
    return [];
  }
  const result: string[][] = [];
  const segments = [
    ...splitTopLevel(command),
    ...extractSubstitutions(command).flatMap((s) => splitTopLevel(s)),
  ];
  for (const raw of segments) {
    let tokens = tokenize(raw.replace(/^[({]+\s*/, "").replace(/\s*[)}]+$/, ""));
    for (;;) {
      while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
        tokens = tokens.slice(1);
      }
      if (tokens.length && WRAPPERS.has(baseName(tokens[0]))) {
        tokens = tokens.slice(1);
        // `sudo -u root cmd`, `env -i cmd`: drop option flags.
        while (tokens.length && tokens[0].startsWith("-")) {
          tokens = tokens.slice(1);
        }
        continue;
      }
      break;
    }
    if (!tokens.length) {
      continue;
    }
    if (SHELLS.has(baseName(tokens[0]))) {
      const cIdx = tokens.findIndex((t) => /^-[a-z]*c[a-z]*$/.test(t));
      if (cIdx >= 0 && tokens[cIdx + 1]) {
        result.push(...splitShellCommands(tokens[cIdx + 1], depth + 1));
        continue;
      }
    }
    if (baseName(tokens[0]) === "xargs" || baseName(tokens[0]) === "eval") {
      let start = 1;
      while (start < tokens.length && tokens[start].startsWith("-")) {
        start++;
      }
      const rest = tokens.slice(start);
      if (rest.length) {
        result.push(...splitShellCommands(rest.join(" "), depth + 1));
      }
    }
    result.push(tokens);
  }
  return result;
}

function baseName(token: string): string {
  const i = token.lastIndexOf("/");
  return i >= 0 ? token.slice(i + 1) : token;
}

function hasShortFlag(args: string[], letters: string): boolean {
  return args.some(
    (a) =>
      /^-[A-Za-z]+$/.test(a) && [...letters].every((l) => a.includes(l)),
  );
}

function hasAnyShortFlag(args: string[], letters: string): boolean {
  return args.some(
    (a) => /^-[A-Za-z]+$/.test(a) && [...letters].some((l) => a.includes(l)),
  );
}

function gitSubcommand(args: string[]): { sub: string; rest: string[] } | null {
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === "-C" || a === "-c" || a === "--git-dir" || a === "--work-tree") {
      i += 2;
      continue;
    }
    if (a.startsWith("-")) {
      i++;
      continue;
    }
    return { sub: a, rest: args.slice(i + 1) };
  }
  return null;
}

const RAW_DEVICE_RE = /^\/dev\/(sd|hd|vd|xvd|nvme|mmcblk|disk|rdisk|mapper|md)/;

/**
 * Returns a human-readable reason when the command is dangerous, else null.
 * This covers the extended set; the original `rm -rf` / mkfs / dd patterns
 * live in `toolPolicy.ts`.
 */
export function detectDangerousCommand(command: string): string | null {
  // Redirection into raw block devices, anywhere in the string.
  for (const m of command.matchAll(/>\s*(\/dev\/[^\s;|&)]+)/g)) {
    if (RAW_DEVICE_RE.test(m[1])) {
      return `writes to raw device ${m[1]}`;
    }
  }
  // curl/wget piped to a shell (with optional sudo / env / absolute path).
  if (
    /\b(curl|wget|fetch)\b[^\n]*\|\s*(?:sudo\s+|env\s+)*(?:\S*\/)?(?:ba|z|da|k)?sh\b/i.test(
      command,
    ) ||
    /\b(?:ba|z)?sh\s+<\(\s*(curl|wget)\b/i.test(command) ||
    /\b(?:ba|z)?sh\s+-c\s+["']?\$\(\s*(curl|wget)\b/i.test(command)
  ) {
    return "pipes a downloaded script into a shell";
  }

  for (const tokens of splitShellCommands(command)) {
    const cmd = baseName(tokens[0]);
    const args = tokens.slice(1);

    if (cmd === "git") {
      const parsed = gitSubcommand(args);
      if (!parsed) {
        continue;
      }
      const { sub, rest } = parsed;
      if (
        sub === "push" &&
        (rest.some(
          (a) =>
            a === "--force" ||
            a === "-f" ||
            (a.startsWith("+") && a.length > 1 && !a.startsWith("+refs/tags")),
        ) ||
          hasShortFlag(rest, "f"))
      ) {
        return "git push --force can overwrite remote history";
      }
      if (sub === "reset" && rest.includes("--hard")) {
        return "git reset --hard discards uncommitted work";
      }
      if (
        sub === "clean" &&
        (rest.includes("--force") || hasShortFlag(rest, "f")) &&
        !rest.includes("-n") &&
        !rest.includes("--dry-run")
      ) {
        return "git clean -f deletes untracked files";
      }
      if (
        sub === "checkout" &&
        (rest.includes("--") && rest[rest.length - 1] === "." )
      ) {
        return "git checkout -- . discards uncommitted work";
      }
      continue;
    }

    if (cmd === "chmod" || cmd === "chown" || cmd === "chgrp") {
      if (
        hasAnyShortFlag(args, "R") ||
        args.includes("--recursive")
      ) {
        return `${cmd} -R changes permissions or ownership recursively`;
      }
      continue;
    }

    if (cmd === "find") {
      if (
        args.includes("-delete") ||
        args.some((a, i) => a === "-exec" && /^(rm|shred|unlink)$/.test(baseName(args[i + 1] ?? "")))
      ) {
        return "find with -delete / -exec rm removes files in bulk";
      }
      continue;
    }

    if (cmd === "shred" || cmd === "wipefs" || cmd === "fdisk" || cmd === "parted") {
      return `${cmd} destroys data`;
    }

    if (cmd === "truncate" || cmd === "tee" || cmd === "cp" || cmd === "mv" || cmd === "dd") {
      if (args.some((a) => RAW_DEVICE_RE.test(a.replace(/^of=/, "")))) {
        return `${cmd} writes to a raw device`;
      }
    }
  }
  return null;
}

/**
 * Absolute-looking targets of output redirections (`>`, `>>`, `tee`) in the
 * command. Used to flag writes outside the workspace.
 */
export function extractWriteTargets(command: string): string[] {
  const out: string[] = [];
  for (const m of command.matchAll(
    /(?:^|[^<>&\d])\d?>>?\s*(?!&)("[^"]+"|'[^']+'|[^\s;|&)]+)/g,
  )) {
    out.push(m[1].replace(/^["']|["']$/g, ""));
  }
  for (const tokens of splitShellCommands(command)) {
    if (baseName(tokens[0]) === "tee") {
      out.push(...tokens.slice(1).filter((t) => !t.startsWith("-")));
    }
  }
  return out.filter(
    (t) => t && t !== "/dev/null" && !/^\/dev\/(stdout|stderr|tty)$/.test(t),
  );
}
