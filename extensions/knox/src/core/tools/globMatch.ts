/**
 * Minimal glob matcher for workspace file discovery.
 * Supports `*`, `?`, and `**` (across path segments). Not a full minimatch port.
 */

export function normalizeGlobPattern(pattern: string): string {
  const trimmed = pattern.trim().replace(/\\/g, "/");
  if (!trimmed) {
    return trimmed;
  }
  // Bare filename globs (`*.ts`) should match at any depth.
  if (!trimmed.includes("/") && !trimmed.includes("**")) {
    return `**/${trimmed}`;
  }
  return trimmed;
}

export function globToRegExp(pattern: string): RegExp {
  const normalized = normalizeGlobPattern(pattern);
  let regex = "";
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    const next = normalized[i + 1];
    if (ch === "*" && next === "*") {
      const after = normalized[i + 2];
      if (after === "/") {
        regex += "(?:.*/)?";
        i += 2;
      } else {
        regex += ".*";
        i += 1;
      }
      continue;
    }
    if (ch === "*") {
      regex += "[^/]*";
      continue;
    }
    if (ch === "?") {
      regex += "[^/]";
      continue;
    }
    if (".+^${}()|[]\\".includes(ch)) {
      regex += `\\${ch}`;
      continue;
    }
    regex += ch;
  }
  return new RegExp(`^${regex}$`);
}

export function matchGlob(relativePath: string, pattern: string): boolean {
  const path = relativePath.replace(/\\/g, "/");
  const re = globToRegExp(pattern);
  return re.test(path) || re.test(path.split("/").pop() ?? path);
}
