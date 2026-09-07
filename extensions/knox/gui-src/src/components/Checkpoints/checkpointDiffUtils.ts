import * as Diff from "diff";

export interface WordChange {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export interface DiffLine {
  type: "context" | "added" | "removed";
  oldLineNum: number | null;
  newLineNum: number | null;
  content: string;
  /** For modified lines (removed+added pair), word-level changes */
  wordChanges?: WordChange[];
}

/** Language detection from file extension */
export function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const languageMap: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    java: "java",
    cpp: "cpp",
    c: "c",
    cs: "csharp",
    go: "go",
    rs: "rust",
    php: "php",
    rb: "ruby",
    swift: "swift",
    kt: "kotlin",
    html: "html",
    css: "css",
    scss: "scss",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    sql: "sql",
    sh: "bash",
    xml: "xml",
    vue: "xml",
    toml: "toml",
    ini: "ini",
  };
  return languageMap[ext] || "plaintext";
}

/** A logical hunk groups consecutive related changes */
export interface LogicalHunk {
  label: string;
  startIndex: number;
  endIndex: number;
  type: "modification" | "addition" | "deletion" | "mixed";
  additions: number;
  deletions: number;
}

/** Semantic annotation for a change */
export interface SemanticAnnotation {
  hunkIndex: number;
  label: string;
  type: "rename" | "refactor" | "addition" | "deletion" | "modification";
}

/** Build logical hunks from aligned lines */
export function buildLogicalHunks(
  alignedLines: { left: DiffLine | null; right: DiffLine | null }[],
): LogicalHunk[] {
  const hunks: LogicalHunk[] = [];
  let hunkStart = -1;
  let hunkAdds = 0;
  let hunkDels = 0;

  const flushHunk = (endIndex: number) => {
    if (hunkStart < 0) return;
    let type: LogicalHunk["type"] = "mixed";
    if (hunkAdds > 0 && hunkDels === 0) type = "addition";
    else if (hunkDels > 0 && hunkAdds === 0) type = "deletion";
    else if (hunkAdds > 0 && hunkDels > 0) type = "modification";
    hunks.push({
      label: `Change ${hunks.length + 1}: +${hunkAdds}/-${hunkDels}`,
      startIndex: hunkStart,
      endIndex,
      type,
      additions: hunkAdds,
      deletions: hunkDels,
    });
    hunkStart = -1;
    hunkAdds = 0;
    hunkDels = 0;
  };

  for (let i = 0; i < alignedLines.length; i++) {
    const { left, right } = alignedLines[i];
    const isChanged =
      (left && left.type !== "context") || (right && right.type !== "context");
    if (isChanged) {
      if (hunkStart < 0) hunkStart = i;
      if (left?.type === "removed") hunkDels++;
      if (right?.type === "added") hunkAdds++;
    } else {
      flushHunk(i - 1);
    }
  }
  flushHunk(alignedLines.length - 1);
  return hunks;
}

/** Detect semantic annotations (e.g., renames) from hunks */
export function detectSemanticAnnotations(
  hunks: LogicalHunk[],
  alignedLines: { left: DiffLine | null; right: DiffLine | null }[],
): SemanticAnnotation[] {
  const annotations: SemanticAnnotation[] = [];
  const funcPattern = /(?:function|def|fn|func|pub fn|async fn)\s+(\w+)/;
  const classPattern = /(?:class|interface|struct|enum|type)\s+(\w+)/;

  for (let hi = 0; hi < hunks.length; hi++) {
    const hunk = hunks[hi];
    const removedNames: string[] = [];
    const addedNames: string[] = [];
    for (let i = hunk.startIndex; i <= hunk.endIndex; i++) {
      const { left, right } = alignedLines[i];
      if (left?.type === "removed") {
        const fm = left.content.match(funcPattern);
        const cm = left.content.match(classPattern);
        if (fm) removedNames.push(fm[1]);
        if (cm) removedNames.push(cm[1]);
      }
      if (right?.type === "added") {
        const fm = right.content.match(funcPattern);
        const cm = right.content.match(classPattern);
        if (fm) addedNames.push(fm[1]);
        if (cm) addedNames.push(cm[1]);
      }
    }
    if (
      removedNames.length === 1 &&
      addedNames.length === 1 &&
      removedNames[0] !== addedNames[0]
    ) {
      annotations.push({
        hunkIndex: hi,
        label: `Renamed \`${removedNames[0]}\` → \`${addedNames[0]}\``,
        type: "rename",
      });
    }
  }
  return annotations;
}

/** File-type specific diff for JSON files */
export function renderJsonDiff(
  oldContent: string,
  newContent: string,
): {
  path: string;
  oldVal: string;
  newVal: string;
  type: "added" | "removed" | "modified";
}[] {
  try {
    const oldObj = JSON.parse(oldContent);
    const newObj = JSON.parse(newContent);
    return diffObjects(oldObj, newObj, "");
  } catch {
    return [];
  }
}

export function diffObjects(
  oldObj: any,
  newObj: any,
  prefix: string,
): {
  path: string;
  oldVal: string;
  newVal: string;
  type: "added" | "removed" | "modified";
}[] {
  const results: {
    path: string;
    oldVal: string;
    newVal: string;
    type: "added" | "removed" | "modified";
  }[] = [];
  const allKeys = new Set([
    ...Object.keys(oldObj || {}),
    ...Object.keys(newObj || {}),
  ]);
  for (const key of allKeys) {
    const p = prefix ? `${prefix}.${key}` : key;
    const ov = oldObj?.[key];
    const nv = newObj?.[key];
    if (ov === undefined) {
      results.push({
        path: p,
        oldVal: "",
        newVal: JSON.stringify(nv),
        type: "added",
      });
    } else if (nv === undefined) {
      results.push({
        path: p,
        oldVal: JSON.stringify(ov),
        newVal: "",
        type: "removed",
      });
    } else if (
      typeof ov === "object" &&
      typeof nv === "object" &&
      !Array.isArray(ov) &&
      !Array.isArray(nv)
    ) {
      results.push(...diffObjects(ov, nv, p));
    } else if (JSON.stringify(ov) !== JSON.stringify(nv)) {
      results.push({
        path: p,
        oldVal: JSON.stringify(ov),
        newVal: JSON.stringify(nv),
        type: "modified",
      });
    }
  }
  return results;
}

/** File-type specific diff for CSS files */
export function renderCssDiff(
  oldContent: string,
  newContent: string,
): {
  selector: string;
  property: string;
  oldVal: string;
  newVal: string;
  type: "added" | "removed" | "modified";
}[] {
  const parseCSS = (content: string) => {
    const rules: Record<string, Record<string, string>> = {};
    const ruleRegex = /([^{]+)\{([^}]*)\}/g;
    let match;
    while ((match = ruleRegex.exec(content)) !== null) {
      const selector = match[1].trim();
      const props: Record<string, string> = {};
      match[2].split(";").forEach((decl) => {
        const [prop, val] = decl.split(":").map((s) => s.trim());
        if (prop && val) props[prop] = val;
      });
      rules[selector] = props;
    }
    return rules;
  };

  const oldRules = parseCSS(oldContent);
  const newRules = parseCSS(newContent);
  const results: {
    selector: string;
    property: string;
    oldVal: string;
    newVal: string;
    type: "added" | "removed" | "modified";
  }[] = [];
  const allSelectors = new Set([
    ...Object.keys(oldRules),
    ...Object.keys(newRules),
  ]);

  for (const sel of allSelectors) {
    const oldProps = oldRules[sel] || {};
    const newProps = newRules[sel] || {};
    const allProps = new Set([
      ...Object.keys(oldProps),
      ...Object.keys(newProps),
    ]);
    for (const prop of allProps) {
      if (!oldProps[prop]) {
        results.push({
          selector: sel,
          property: prop,
          oldVal: "",
          newVal: newProps[prop],
          type: "added",
        });
      } else if (!newProps[prop]) {
        results.push({
          selector: sel,
          property: prop,
          oldVal: oldProps[prop],
          newVal: "",
          type: "removed",
        });
      } else if (oldProps[prop] !== newProps[prop]) {
        results.push({
          selector: sel,
          property: prop,
          oldVal: oldProps[prop],
          newVal: newProps[prop],
          type: "modified",
        });
      }
    }
  }
  return results;
}

/**
 * Compute aligned diff lines for split view with word-level changes.
 * Pairs removed+added hunks to detect modifications and computes word diffs.
 */
export function computeAlignedLines(
  changes: Diff.Change[],
): { left: DiffLine | null; right: DiffLine | null }[] {
  const aligned: { left: DiffLine | null; right: DiffLine | null }[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    const lines = change.value.endsWith("\n")
      ? change.value.slice(0, -1).split("\n")
      : change.value.split("\n");

    if (!change.added && !change.removed) {
      for (const line of lines) {
        aligned.push({
          left: {
            type: "context",
            oldLineNum: oldLine++,
            newLineNum: null,
            content: line,
          },
          right: {
            type: "context",
            oldLineNum: null,
            newLineNum: newLine++,
            content: line,
          },
        });
      }
    } else if (change.removed) {
      const next = changes[i + 1];
      if (next?.added) {
        const addedLines = next.value.endsWith("\n")
          ? next.value.slice(0, -1).split("\n")
          : next.value.split("\n");
        const maxLen = Math.max(lines.length, addedLines.length);
        for (let j = 0; j < maxLen; j++) {
          const oldContent = j < lines.length ? lines[j] : undefined;
          const newContent = j < addedLines.length ? addedLines[j] : undefined;
          const wordChanges =
            oldContent !== undefined && newContent !== undefined
              ? (Diff.diffWords(oldContent, newContent) as WordChange[])
              : undefined;
          aligned.push({
            left:
              oldContent !== undefined
                ? {
                    type: "removed",
                    oldLineNum: oldLine++,
                    newLineNum: null,
                    content: oldContent,
                    wordChanges,
                  }
                : null,
            right:
              newContent !== undefined
                ? {
                    type: "added",
                    oldLineNum: null,
                    newLineNum: newLine++,
                    content: newContent,
                    wordChanges,
                  }
                : null,
          });
        }
        i++;
      } else {
        for (const line of lines) {
          aligned.push({
            left: {
              type: "removed",
              oldLineNum: oldLine++,
              newLineNum: null,
              content: line,
            },
            right: null,
          });
        }
      }
    } else if (change.added) {
      for (const line of lines) {
        aligned.push({
          left: null,
          right: {
            type: "added",
            oldLineNum: null,
            newLineNum: newLine++,
            content: line,
          },
        });
      }
    }
  }

  return aligned;
}
