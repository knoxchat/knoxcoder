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

/** Wrapper options that consume the following token as their value. */
const WRAPPER_VALUE_FLAGS: Record<string, Set<string>> = {
  sudo: new Set(["-u", "-g", "-h", "-p", "-C", "-D", "-R", "-T", "-U", "-r", "-t"]),
  doas: new Set(["-u", "-C"]),
  nice: new Set(["-n"]),
  env: new Set(["-u", "-C", "-S"]),
};

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
        const wrapper = baseName(tokens[0]);
        tokens = tokens.slice(1);
        // `sudo -u root cmd`, `nice -n 5 cmd`, `env -i cmd`: drop options
        // (and the value of options that take one).
        const withValue = WRAPPER_VALUE_FLAGS[wrapper];
        while (tokens.length && tokens[0].startsWith("-")) {
          const flag = tokens[0];
          tokens = tokens.slice(1);
          if (withValue?.has(flag) && tokens.length) {
            tokens = tokens.slice(1);
          }
        }
        // `nice -5 cmd` style is covered by the `-` loop; `nice 5 cmd` is not valid.
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
      // `bash -s <<< 'script'`: the here-string is the script.
      const hereIdx = tokens.indexOf("<<<");
      if (hereIdx >= 0 && tokens[hereIdx + 1]) {
        result.push(...splitShellCommands(tokens[hereIdx + 1], depth + 1));
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
  const i = Math.max(token.lastIndexOf("/"), token.lastIndexOf("\\"));
  return i >= 0 ? token.slice(i + 1) : token;
}

/** Lowercased command name without a Windows executable extension. */
function winName(token: string): string {
  return baseName(token).toLowerCase().replace(/\.(exe|cmd|bat|com)$/, "");
}

const WIN_SHELLS = new Set(["cmd", "powershell", "pwsh"]);

/** Returns a reason when a Windows (cmd / PowerShell) command is destructive. */
function detectWindowsDanger(tokens: string[]): string | null {
  const name = winName(tokens[0]);
  const args = tokens.slice(1);
  if (
    (name === "powershell" || name === "pwsh") &&
    args.some((a) => /^-e(c|nc|ncodedcommand|ncodedcomma?n?d?)?$/i.test(a))
  ) {
    return "PowerShell -EncodedCommand hides what will run";
  }
  const lower = args.map((a) => a.toLowerCase());
  const flag = (f: string) => lower.some((a) => a === `/${f}` || a === `-${f}`);

  // `-r` is unambiguous only for Remove-Item; POSIX `rm -r` is handled by toolPolicy.
  const psRecurse = lower.some((a) =>
    name === "remove-item" || name === "ri"
      ? /^-r(e(c(u(r(se?)?)?)?)?)?$/.test(a)
      : /^-re(c(u(r(se?)?)?)?)?$/.test(a),
  );
  const psAlias = ["remove-item", "ri", "rm", "del", "erase", "rmdir", "rd"].includes(name);

  if ((name === "del" || name === "erase") && (flag("s") || (flag("q") && flag("f")))) {
    return "del removes files recursively or without confirmation";
  }
  if ((name === "rd" || name === "rmdir") && flag("s")) {
    return "rd /s removes a directory tree";
  }
  if (psAlias && psRecurse) {
    return "Remove-Item -Recurse deletes a directory tree";
  }
  if (name === "format" && lower.some((a) => /^[a-z]:$/.test(a))) {
    return "format erases a disk volume";
  }
  if (name === "diskpart" || (name === "cipher" && lower.some((a) => a.startsWith("/w")))) {
    return `${name} can destroy disk data`;
  }
  if (name === "reg" && lower[0] === "delete") {
    return "reg delete removes registry keys";
  }
  if (name === "clear-disk" || name === "format-volume" || name === "remove-partition") {
    return `${name} destroys disk data`;
  }
  return null;
}

/** Inner script of `cmd /c ...` or `powershell -Command ...`. */
function windowsShellScript(tokens: string[]): string | null {
  const name = winName(tokens[0]);
  if (!WIN_SHELLS.has(name)) {
    return null;
  }
  const idx = tokens.findIndex((t, i) => {
    if (i === 0) {
      return false;
    }
    const l = t.toLowerCase();
    return name === "cmd" ? l === "/c" || l === "/k" : l === "-command" || l === "-c";
  });
  if (idx < 0 || idx + 1 >= tokens.length) {
    return null;
  }
  return tokens.slice(idx + 1).join(" ");
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

const INTERPRETERS =
  "(?:(?:ba|z|da|k|c|fi)?sh|python[0-9.]*|node|nodejs|perl|ruby|php|pwsh|powershell|deno|bun)";

/** Git config keys that make git run an arbitrary program. */
const GIT_EXEC_CONFIG_RE =
  /^(?:alias\.[^=]+=\s*!|core\.(?:sshcommand|fsmonitor|editor|hookspath|askpass|gitproxy)=|credential\.helper=|diff\.external=|protocol\.ext\.allow=|filter\.[^=]+\.(?:clean|smudge|process)=|merge\.[^=]+\.driver=)/i;

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
  // curl/wget piped to a shell or script interpreter.
  if (
    new RegExp(
      `\\b(curl|wget|fetch)\\b[^\\n]*\\|\\s*(?:sudo\\s+|env\\s+)*(?:\\S*\\/)?${INTERPRETERS}\\b`,
      "i",
    ).test(command) ||
    /\b(?:ba|z)?sh\s+<\(\s*(curl|wget)\b/i.test(command) ||
    /\b(?:ba|z)?sh\s+-c\s+["']?\$\(\s*(curl|wget)\b/i.test(command)
  ) {
    return "pipes a downloaded script into a shell";
  }
  // Decoded payloads piped into a shell (`base64 -d | sh`, `xxd -r | bash`).
  if (
    new RegExp(
      `\\b(?:base64\\s+(?:-d|-D|--decode)|xxd\\s+-r|openssl\\s+(?:enc|base64)\\b[^|\\n]*-d|basenc\\b[^|\\n]*--decode)\\b[^\\n]*\\|\\s*(?:sudo\\s+|env\\s+)*(?:\\S*\\/)?${INTERPRETERS}\\b`,
      "i",
    ).test(command)
  ) {
    return "pipes a decoded payload into a shell";
  }
  // PowerShell download-and-execute and opaque encoded commands.
  if (
    /\b(?:iex|invoke-expression)\b/i.test(command) &&
    /\b(?:iwr|irm|invoke-webrequest|invoke-restmethod|downloadstring|downloadfile|curl|wget)\b/i.test(command)
  ) {
    return "executes downloaded PowerShell code";
  }

  for (const tokens of splitShellCommands(command)) {
    const cmd = baseName(tokens[0]);
    const args = tokens.slice(1);

    const winReason = detectWindowsDanger(tokens);
    if (winReason) {
      return winReason;
    }
    const inner = windowsShellScript(tokens);
    if (inner) {
      const nested = detectDangerousCommand(inner);
      if (nested) {
        return nested;
      }
    }

    if (cmd === "git") {
      const parsed = gitSubcommand(args);
      if (!parsed) {
        continue;
      }
      const { sub, rest } = parsed;
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        let cfg: string | undefined;
        if (a === "-c" || a === "--config") {
          cfg = args[i + 1];
        } else if (a.startsWith("--config=")) {
          cfg = a.slice("--config=".length);
        } else if (/^-c.+/s.test(a)) {
          cfg = a.slice(2); // glued form: -calias.x=!cmd
        }
        if (cfg !== undefined && GIT_EXEC_CONFIG_RE.test(cfg)) {
          return "git -c sets a config key that runs an arbitrary program";
        }
      }
      if (
        sub === "push" &&
        (rest.some(
          (a) =>
            a === "--force" ||
            a === "-f" ||
            a === "--mirror" ||
            a === "--delete" ||
            a === "-d" ||
            (a.startsWith(":") && a.length > 1) ||
            (a.startsWith("+") && a.length > 1 && !a.startsWith("+refs/tags")),
        ) ||
          hasShortFlag(rest, "f"))
      ) {
        return "git push --force can overwrite remote history";
      }
      if (sub === "reset" && (rest.includes("--hard") || rest.includes("--merge"))) {
        return "git reset --hard discards uncommitted work";
      }
      if (sub === "checkout" && (rest.includes("-f") || rest.includes("--force"))) {
        return "git checkout --force discards uncommitted work";
      }
      if (sub === "branch" && rest.includes("-D")) {
        return "git branch -D deletes a branch without merge checks";
      }
      if (sub === "stash" && (rest[0] === "clear" || rest[0] === "drop")) {
        return "git stash clear/drop discards stashed work";
      }
      if (sub === "reflog" && rest[0] === "expire") {
        return "git reflog expire removes recovery points";
      }
      if (sub === "gc" && rest.some((a) => a.startsWith("--prune=now"))) {
        return "git gc --prune=now permanently removes unreachable objects";
      }
      if (sub === "filter-branch" || sub === "filter-repo") {
        return `git ${sub} rewrites history`;
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

    if (cmd === "rm") {
      const recursive = args.some(
        (a) => a === "--recursive" || (/^-[A-Za-z]+$/.test(a) && /[rR]/.test(a)),
      );
      const force = args.some(
        (a) => a === "--force" || (/^-[A-Za-z]+$/.test(a) && a.includes("f")),
      );
      if (recursive && force) {
        return "rm -r -f removes a directory tree without confirmation";
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
      if (args.includes("-delete")) {
        return "find with -delete / -exec rm removes files in bulk";
      }
      for (let i = 0; i < args.length; i++) {
        if (["-exec", "-execdir", "-ok", "-okdir"].includes(args[i])) {
          let end = i + 1;
          while (end < args.length && args[end] !== ";" && args[end] !== "\\;" && args[end] !== "+") {
            end++;
          }
          const inner = args.slice(i + 1, end).join(" ");
          if (/^(rm|shred|unlink)$/.test(baseName(args[i + 1] ?? ""))) {
            return "find with -delete / -exec rm removes files in bulk";
          }
          const nested = detectDangerousCommand(inner);
          if (nested) {
            return nested;
          }
        }
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
