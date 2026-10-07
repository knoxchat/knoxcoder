/**
 * vscode-free in-editor assist: find places where an instruction-triggered edit
 * helps (empty file, stub function, TODO comment) and build the prompts.
 *
 * No fill-in-the-middle model is involved. Targets feed the normal edit model
 * through the vertical diff, so every result stays a reviewable diff.
 */

export type AssistKind = "emptyFile" | "stub" | "todo" | "diagnostic";

export interface AssistTarget {
  kind: AssistKind;
  /** First line of the range the edit should cover (0-based, inclusive). */
  startLine: number;
  /** Last line of the range (0-based, inclusive). */
  endLine: number;
  /** Line the CodeLens is shown on. */
  lensLine: number;
  title: string;
  prompt: string;
}

const MAX_BODY_LINES = 80;
const MAX_TODO_CONTEXT = 30;

const TODO_RE =
  /(?:\/\/|#|--|\/\*+|<!--|^\s*\*)\s*(?:TODO|FIXME)\b[:\s(-]*(.*)$/i;

const STUB_BODY_RE =
  /^(?:pass|\.\.\.|throw\s+new\s+\w*Error\(\s*["'`][^"'`]*(?:not\s+implemented|todo|unimplemented)[^"'`]*["'`]\s*\);?|raise\s+NotImplementedError.*|(?:todo|unimplemented)!\(.*\);?|panic\(\s*"[^"]*(?:todo|not\s+implemented|unimplemented)[^"]*"\s*\)|throw\s+new\s+NotImplementedException\(.*\);?|fatalError\(.*\))$/i;

const NON_FUNCTION_HEAD_RE =
  /^\s*(?:\}\s*)?(?:if|else|for|foreach|while|do|switch|try|catch|finally|with|using|lock|class|interface|enum|namespace|struct|impl|trait|module|object)\b/;

function isCommentOnly(line: string): boolean {
  const t = line.trim();
  return (
    t === "" ||
    t.startsWith("//") ||
    t.startsWith("#") ||
    t.startsWith("/*") ||
    t.startsWith("*") ||
    t.startsWith("--")
  );
}

function indentOf(line: string): number {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0].replace(/\t/g, "    ").length : 0;
}

function looksLikeFunctionHead(line: string): boolean {
  if (NON_FUNCTION_HEAD_RE.test(line)) {
    return false;
  }
  if (!/\(/.test(line) || !/\)/.test(line)) {
    return false;
  }
  // Calls such as `foo(bar) {` inside expressions are rare; require a name or
  // `function` / arrow in front of the parameter list.
  return /(?:function\b|=>|\b[A-Za-z_$][\w$]*\s*(?:<[^>]*>)?\s*\()/.test(line);
}

function pythonStubs(lines: string[]): AssistTarget[] {
  const out: AssistTarget[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(lines[i]);
    if (!m) {
      continue;
    }
    // Find the end of the signature (may wrap lines).
    let sigEnd = i;
    while (sigEnd < lines.length - 1 && !/:\s*(#.*)?$/.test(lines[sigEnd])) {
      sigEnd++;
      if (sigEnd - i > 15) {
        break;
      }
    }
    const baseIndent = indentOf(lines[i]);
    const body: string[] = [];
    let last = sigEnd;
    for (let j = sigEnd + 1; j < lines.length && j - sigEnd <= MAX_BODY_LINES; j++) {
      const l = lines[j];
      if (l.trim() === "") {
        continue;
      }
      if (indentOf(l) <= baseIndent) {
        break;
      }
      body.push(l.trim());
      last = j;
    }
    const meaningful = body.filter(
      (l) => !l.startsWith("#") && !/^(?:"""|''').*(?:"""|''')$/.test(l),
    );
    const onlyDocstring = body.length > 0 && meaningful.length === 0;
    const stub =
      body.length === 0 ||
      onlyDocstring ||
      (meaningful.length <= 2 && meaningful.every((l) => STUB_BODY_RE.test(l)));
    if (stub) {
      out.push(stubTarget(i, last, m[2]));
    }
  }
  return out;
}

function braceStubs(lines: string[]): AssistTarget[] {
  const out: AssistTarget[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!looksLikeFunctionHead(line)) {
      continue;
    }
    // Same-line empty body: `foo() {}`.
    const emptyInline = /\)\s*(?::\s*[^{]+)?\s*(?:=>\s*)?\{\s*\}\s*;?\s*$/.test(line);
    if (emptyInline) {
      out.push(stubTarget(i, i, nameOf(line)));
      continue;
    }
    if (!/\{\s*$/.test(line)) {
      continue;
    }
    let depth = 0;
    let end = -1;
    const body: string[] = [];
    for (let j = i; j < lines.length && j - i <= MAX_BODY_LINES; j++) {
      const text = lines[j];
      for (const ch of text) {
        if (ch === "{") {
          depth++;
        } else if (ch === "}") {
          depth--;
        }
      }
      if (j > i) {
        body.push(text);
      }
      if (depth <= 0) {
        end = j;
        break;
      }
    }
    if (end < 0) {
      continue;
    }
    const inner = body.slice(0, -1).filter((l) => !isCommentOnly(l));
    const stub =
      inner.length === 0 ||
      (inner.length === 1 && STUB_BODY_RE.test(inner[0].trim()));
    if (stub) {
      out.push(stubTarget(i, end, nameOf(line)));
    }
  }
  return out;
}

function nameOf(line: string): string {
  const m =
    /function\s+\*?\s*([A-Za-z_$][\w$]*)/.exec(line) ??
    /\b([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/.exec(line);
  return m?.[1] ?? "this function";
}

function stubTarget(startLine: number, endLine: number, name: string): AssistTarget {
  return {
    kind: "stub",
    startLine,
    endLine,
    lensLine: startLine,
    title: "Knox: Implement",
    prompt: buildAssistPrompt("stub", { name }),
  };
}

function todoTargets(lines: string[], taken: AssistTarget[]): AssistTarget[] {
  const out: AssistTarget[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = TODO_RE.exec(lines[i]);
    if (!m) {
      continue;
    }
    // A TODO inside a stub already gets the stub lens.
    if (taken.some((t) => i >= t.startLine && i <= t.endLine)) {
      continue;
    }
    let end = i;
    let j = i + 1;
    // Include the code the comment describes: up to the next blank line.
    while (j < lines.length && j - i <= MAX_TODO_CONTEXT && lines[j].trim() !== "") {
      end = j;
      j++;
    }
    const text = m[1].replace(/\*\/\s*$|-->\s*$/, "").trim();
    out.push({
      kind: "todo",
      startLine: i,
      endLine: end,
      lensLine: i,
      title: "Knox: Do this TODO",
      prompt: buildAssistPrompt("todo", { text }),
    });
  }
  return out;
}

/** Find assist targets in a document. Diagnostics are added by the host. */
export function findAssistTargets(text: string, languageId: string): AssistTarget[] {
  if (text.trim() === "") {
    return [
      {
        kind: "emptyFile",
        startLine: 0,
        endLine: 0,
        lensLine: 0,
        title: "Knox: Generate this file",
        prompt: buildAssistPrompt("emptyFile", { languageId }),
      },
    ];
  }
  const lines = text.split(/\r?\n/);
  const stubs =
    languageId === "python" ? pythonStubs(lines) : braceStubs(lines);
  const todos = todoTargets(lines, stubs);
  return [...stubs, ...todos].sort((a, b) => a.lensLine - b.lensLine);
}

/** The narrowest target containing `line`, so ⌘I can scope itself to it. */
export function targetAtLine(
  targets: readonly AssistTarget[],
  line: number,
): AssistTarget | undefined {
  let best: AssistTarget | undefined;
  for (const t of targets) {
    if (line < t.startLine || line > t.endLine) {
      continue;
    }
    if (!best || t.endLine - t.startLine < best.endLine - best.startLine) {
      best = t;
    }
  }
  return best;
}

export function buildAssistPrompt(
  kind: AssistKind,
  info: { name?: string; text?: string; languageId?: string; message?: string },
): string {
  switch (kind) {
    case "emptyFile":
      return (
        "This file is empty. Write its complete contents for a sensible first version, " +
        "judging from the file name, its folder and the language" +
        (info.languageId ? ` (${info.languageId})` : "") +
        ". Follow the style of neighbouring files. Keep it small and runnable; no placeholder code."
      );
    case "stub":
      return (
        `Implement ${info.name ?? "this function"}. Keep its signature, comments and docstring. ` +
        "Replace the stub body (empty, pass, TODO, or not-implemented error) with a real implementation " +
        "that fits how it is used elsewhere in the project."
      );
    case "todo":
      return (
        "Do what this TODO comment asks" +
        (info.text ? ` ("${info.text}")` : "") +
        ", changing only the code it refers to. Remove the TODO comment once it is done."
      );
    case "diagnostic":
      return `Fix this problem with a minimal change: ${info.message ?? "see the diagnostic"}`;
  }
}

/** Prompt for the single follow-up edit after the user accepted an assist edit. */
export function buildNextEditPrompt(originalPrompt: string): string {
  return (
    `The user just accepted this change: "${originalPrompt.slice(0, 300)}". ` +
    "Find at most ONE closely related spot in this file that now needs a matching change " +
    "(a caller, a duplicate, a type, a doc comment, an import). Make only that change. " +
    "If nothing in this file needs one, return the code unchanged."
  );
}

export interface NextEditState {
  fileUri: string;
  prompt: string;
  /** True once the follow-up has been offered, so it is never chained. */
  followUp: boolean;
}

/** Offer a next edit only after a first-hand assist edit, once per chain. */
export function shouldOfferNextEdit(
  state: NextEditState | undefined,
  acceptedFileUri: string,
  enabled: boolean,
): boolean {
  return Boolean(
    enabled && state && !state.followUp && state.fileUri === acceptedFileUri,
  );
}
