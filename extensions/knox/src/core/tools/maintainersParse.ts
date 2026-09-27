/**
 * Linux / QEMU MAINTAINERS parser (HL-20 follow-up).
 *
 * Do not dump the file. Lookup is F:/X: glob match; search is title/M/L/F.
 */

export interface MaintainerRecord {
  title: string;
  maintainers: string[];
  reviewers: string[];
  lists: string[];
  status?: string;
  files: string[];
  excludes: string[];
  keywords: string[];
}

const TAG = /^([A-Z]):\s*(.*)$/;

export function normalizeMaintainerPath(raw: string): string {
  return raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/** Shell-style glob from repo root. Trailing `/` is a directory prefix. */
export function matchMaintainerPattern(relPath: string, pattern: string): boolean {
  const path = normalizeMaintainerPath(relPath);
  const pat = normalizeMaintainerPath(pattern);
  if (!path || !pat) {
    return false;
  }
  if (pat === "*" || pat === "**") {
    return true;
  }
  if (pat.endsWith("/")) {
    return path === pat.slice(0, -1) || path.startsWith(pat);
  }
  const escaped = pat
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`).test(path);
}

export function parseMaintainers(text: string): MaintainerRecord[] {
  const records: MaintainerRecord[] = [];
  let current: MaintainerRecord | undefined;
  const titleLines: string[] = [];

  const flush = () => {
    if (!current) {
      return;
    }
    const title = current.title.trim();
    if (title) {
      records.push(current);
    }
    current = undefined;
    titleLines.length = 0;
  };

  const ensure = (): MaintainerRecord => {
    if (!current) {
      current = {
        title: titleLines.join(" ").trim(),
        maintainers: [],
        reviewers: [],
        lists: [],
        files: [],
        excludes: [],
        keywords: [],
      };
      titleLines.length = 0;
    }
    return current;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      flush();
      continue;
    }
    const tagged = line.match(TAG);
    if (!tagged) {
      if (current) {
        flush();
      }
      titleLines.push(line.trim());
      continue;
    }
    const rec = ensure();
    if (!rec.title && titleLines.length) {
      rec.title = titleLines.join(" ").trim();
      titleLines.length = 0;
    }
    const value = tagged[2].trim();
    switch (tagged[1]) {
      case "M":
        rec.maintainers.push(value);
        break;
      case "R":
        rec.reviewers.push(value);
        break;
      case "L":
        rec.lists.push(value);
        break;
      case "S":
        rec.status = value;
        break;
      case "F":
        rec.files.push(value);
        break;
      case "X":
        rec.excludes.push(value);
        break;
      case "K":
        rec.keywords.push(value);
        break;
      default:
        break;
    }
  }
  flush();
  return records;
}

export function recordMatchesPath(
  record: MaintainerRecord,
  relPath: string,
): { matched: boolean; specificity: number } {
  if (record.excludes.some((pattern) => matchMaintainerPattern(relPath, pattern))) {
    return { matched: false, specificity: 0 };
  }
  let specificity = 0;
  for (const pattern of record.files) {
    if (!matchMaintainerPattern(relPath, pattern)) {
      continue;
    }
    const score =
      pattern === "*" || pattern === "**"
        ? 1
        : normalizeMaintainerPath(pattern).length;
    if (score > specificity) {
      specificity = score;
    }
  }
  return { matched: specificity > 0, specificity };
}

export function lookupMaintainers(
  records: MaintainerRecord[],
  relPath: string,
  cap = 8,
): { hits: MaintainerRecord[]; truncated: boolean } {
  const scored = records
    .map((record) => ({ record, ...recordMatchesPath(record, relPath) }))
    .filter((item) => item.matched)
    .sort(
      (a, b) =>
        b.specificity - a.specificity || a.record.title.localeCompare(b.record.title),
    );
  const specific = scored.filter((item) => item.specificity > 1);
  const chosen = specific.length > 0 ? specific : scored;
  return {
    hits: chosen.slice(0, cap).map((item) => item.record),
    truncated: chosen.length > cap,
  };
}

export function searchMaintainers(
  records: MaintainerRecord[],
  query: string,
  cap = 12,
): { hits: MaintainerRecord[]; truncated: boolean } {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return { hits: [], truncated: false };
  }
  const hits: MaintainerRecord[] = [];
  for (const record of records) {
    const hay = [
      record.title,
      ...record.maintainers,
      ...record.reviewers,
      ...record.lists,
      ...record.files,
      ...record.keywords,
      record.status ?? "",
    ]
      .join("\n")
      .toLowerCase();
    if (!hay.includes(needle)) {
      continue;
    }
    hits.push(record);
    if (hits.length > cap) {
      return { hits: hits.slice(0, cap), truncated: true };
    }
  }
  return { hits, truncated: false };
}

export function formatMaintainerRecord(record: MaintainerRecord): string {
  const lines = [`### ${record.title}`];
  if (record.status) {
    lines.push(`S: ${record.status}`);
  }
  for (const name of record.maintainers) {
    lines.push(`M: ${name}`);
  }
  for (const name of record.reviewers.slice(0, 4)) {
    lines.push(`R: ${name}`);
  }
  for (const list of record.lists.slice(0, 4)) {
    lines.push(`L: ${list}`);
  }
  const files = record.files.slice(0, 8);
  if (files.length) {
    lines.push(`F: ${files.join(", ")}${record.files.length > 8 ? ", …" : ""}`);
  }
  if (record.excludes.length) {
    lines.push(`X: ${record.excludes.slice(0, 4).join(", ")}`);
  }
  return lines.join("\n");
}

export function formatMaintainerHits(
  hits: MaintainerRecord[],
  opts: { truncated?: boolean; cap: number; empty: string },
): string {
  if (hits.length === 0) {
    return opts.empty;
  }
  const body = hits.map(formatMaintainerRecord).join("\n\n");
  const footer = opts.truncated
    ? `\n\ntruncated at ${opts.cap}; pass a narrower path/query`
    : "";
  return `${body}${footer}`;
}
