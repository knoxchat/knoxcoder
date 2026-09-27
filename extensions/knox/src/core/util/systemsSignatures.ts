/**
 * Heuristic declaration signatures for systems sources tree-sitter does not
 * cover well: GNU as (`.S`/`.s`), Makefile, Kconfig, linker scripts.
 *
 * Used by the repo map (HL-23). C wasm is still preferred for `.c`; `.S` is
 * treated as C-with-preprocessor plus these macros (`SYM_FUNC_START`, `ENTRY`).
 */

const MAX_SIGNATURES = 40;

function basename(filepath: string): string {
  const cleaned = filepath.split("?")[0].replace(/\\/g, "/");
  return cleaned.split("/").pop() ?? cleaned;
}

function extname(filepath: string): string {
  const base = basename(filepath);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  return base.slice(dot + 1).toLowerCase();
}

const CPP_HEADER_RE =
  /\b(class|namespace|template\s*<|virtual\s+|public:|private:|protected:|std::)\b/;

/** Kernel `.h` that is actually a C++ header (clangd/tree-sitter should use cpp). */
export function headerLooksLikeCpp(contents: string): boolean {
  return CPP_HEADER_RE.test(contents);
}

const ASM_MACRO_RE =
  /^\s*(SYM_FUNC_START(?:_[A-Z]+)*|SYM_CODE_START(?:_[A-Z]+)*|SYM_INNER_LABEL(?:_[A-Z]+)*|SYM_FUNC_END(?:_[A-Z]+)*|SYM_CODE_END(?:_[A-Z]+)*|ENTRY|ENDPROC|END|GLOBAL)\s*\(\s*([A-Za-z_][\w.]*)/;

const GLOBL_RE = /^\s*\.glob[al]?\s+([A-Za-z_][\w.]*)/;
const ASMLINKAGE_LINE_RE = /^\s*asmlinkage\b/;

function asmSignatures(contents: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of contents.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) {
      continue;
    }
    const macro = line.match(ASM_MACRO_RE);
    if (macro) {
      const text = `${macro[1]}(${macro[2]})`;
      if (!seen.has(text)) {
        seen.add(text);
        out.push(text);
      }
      continue;
    }
    const globl = line.match(GLOBL_RE);
    if (globl) {
      const text = `.globl ${globl[1]}`;
      if (!seen.has(text)) {
        seen.add(text);
        out.push(text);
      }
      continue;
    }
    if (ASMLINKAGE_LINE_RE.test(line) && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed);
    }
    if (out.length >= MAX_SIGNATURES) {
      break;
    }
  }
  return out;
}

function makefileSignatures(contents: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of contents.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (/^\s*(#|\.PHONY|\.SUFFIXES)/.test(line)) {
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_./][A-Za-z0-9_./%-]*):/);
    if (!match || match[1].startsWith("%")) {
      continue;
    }
    const target = match[1];
    if (seen.has(target)) {
      continue;
    }
    seen.add(target);
    out.push(`${target}:`);
    if (out.length >= MAX_SIGNATURES) {
      break;
    }
  }
  return out;
}

function kconfigSignatures(contents: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of contents.split("\n")) {
    const match = raw.match(/^\s*(menuconfig|config|choice|menu)\s+([A-Za-z0-9_]+)/);
    if (!match) {
      continue;
    }
    const text = `${match[1]} ${match[2]}`;
    if (seen.has(text)) {
      continue;
    }
    seen.add(text);
    out.push(text);
    if (out.length >= MAX_SIGNATURES) {
      break;
    }
  }
  return out;
}

function linkerSignatures(contents: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of contents.split("\n")) {
    const entry = raw.match(/^\s*ENTRY\s*\(\s*([A-Za-z_][\w]*)/);
    if (entry) {
      const text = `ENTRY(${entry[1]})`;
      if (!seen.has(text)) {
        seen.add(text);
        out.push(text);
      }
    }
    const sec = raw.match(/^\s*(SECTIONS|PHDRS|MEMORY)\b/);
    if (sec && !seen.has(sec[1])) {
      seen.add(sec[1]);
      out.push(sec[1]);
    }
    if (out.length >= MAX_SIGNATURES) {
      break;
    }
  }
  return out;
}

function isMakefileName(base: string): boolean {
  const lower = base.toLowerCase();
  return (
    lower === "makefile" ||
    lower === "gnumakefile" ||
    lower === "kbuild" ||
    lower.endsWith(".mk")
  );
}

function isKconfigName(base: string): boolean {
  return base === "Kconfig" || base.startsWith("Kconfig.") || base.endsWith(".kconfig");
}

/**
 * Signatures for languages without a bundled tree-sitter grammar (or when
 * the C parser would mis-read GNU as). Empty means "try tree-sitter / path only".
 */
export function getSystemsFallbackSignatures(
  filepath: string,
  contents: string,
): string[] {
  const base = basename(filepath);
  const ext = extname(filepath);

  if (ext === "s" || ext === "asm" || base.endsWith(".S")) {
    return asmSignatures(contents);
  }
  if (isMakefileName(base)) {
    return makefileSignatures(contents);
  }
  if (isKconfigName(base)) {
    return kconfigSignatures(contents);
  }
  if (ext === "lds" || base.endsWith(".lds.S") || base.endsWith(".lds.h")) {
    return linkerSignatures(contents);
  }
  return [];
}
