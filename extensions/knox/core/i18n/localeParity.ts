import fs from "node:fs";
import path from "node:path";

export type LocaleFlatMap = Record<string, string>;

/** Flatten nested JSON locale objects into dotted keys. */
export function flattenLocale(
  obj: Record<string, unknown>,
  prefix = "",
): LocaleFlatMap {
  const out: LocaleFlatMap = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flattenLocale(v as Record<string, unknown>, key));
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

export type LocaleDrift = {
  file: string;
  missingInZh: string[];
  missingInEn: string[];
};

/**
 * Compare en/zh JSON locale directories. Returns per-file key drift.
 * Both directories must exist; missing counterpart files are reported as
 * all keys missing on that side.
 */
export function compareLocaleDirs(enDir: string, zhDir: string): LocaleDrift[] {
  if (!fs.existsSync(enDir) || !fs.existsSync(zhDir)) {
    throw new Error(`Locale dirs missing: en=${enDir} zh=${zhDir}`);
  }

  const enFiles = fs
    .readdirSync(enDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const zhFiles = new Set(
    fs.readdirSync(zhDir).filter((f) => f.endsWith(".json")),
  );

  const drifts: LocaleDrift[] = [];

  for (const file of enFiles) {
    const enPath = path.join(enDir, file);
    const zhPath = path.join(zhDir, file);
    const en = flattenLocale(
      JSON.parse(fs.readFileSync(enPath, "utf8")) as Record<string, unknown>,
    );

    if (!zhFiles.has(file)) {
      drifts.push({
        file,
        missingInZh: Object.keys(en),
        missingInEn: [],
      });
      continue;
    }

    const zh = flattenLocale(
      JSON.parse(fs.readFileSync(zhPath, "utf8")) as Record<string, unknown>,
    );
    const missingInZh = Object.keys(en).filter((k) => !(k in zh));
    const missingInEn = Object.keys(zh).filter((k) => !(k in en));
    if (missingInZh.length || missingInEn.length) {
      drifts.push({ file, missingInZh, missingInEn });
    }
  }

  for (const file of zhFiles) {
    if (!enFiles.includes(file)) {
      const zh = flattenLocale(
        JSON.parse(
          fs.readFileSync(path.join(zhDir, file), "utf8"),
        ) as Record<string, unknown>,
      );
      drifts.push({
        file,
        missingInZh: [],
        missingInEn: Object.keys(zh),
      });
    }
  }

  return drifts;
}

const MESSAGE_CALL =
  /\b(?:show(?:Information|Warning|Error)Message|setStatusBarMessage)\s*\(/;

/**
 * Find show*Message / setStatusBarMessage calls with raw English string
 * literals (not t(...)). Scans the call site plus a few following lines
 * for multiline arguments. Lines/windows containing `i18n-allow` are skipped.
 */
export function findHardcodedUserMessages(
  roots: string[],
  extensions = [".ts", ".tsx"],
): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = [];

  function walk(dir: string) {
    if (!fs.existsSync(dir)) {
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!extensions.some((ext) => entry.name.endsWith(ext))) {
        continue;
      }
      if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) {
        continue;
      }
      const content = fs.readFileSync(full, "utf8");
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!MESSAGE_CALL.test(lines[i])) {
          continue;
        }
        const window = lines.slice(i, Math.min(lines.length, i + 6)).join("\n");
        if (window.includes("i18n-allow")) {
          continue;
        }
        // First arg is t(...) — OK
        if (
          /(?:show(?:Information|Warning|Error)Message|setStatusBarMessage)\s*\(\s*t\s*\(/.test(
            window,
          )
        ) {
          continue;
        }
        // Raw string / template literal starting with a letter
        if (
          /(?:show(?:Information|Warning|Error)Message|setStatusBarMessage)\s*\(\s*(?:['"`][A-Za-z]|\[\s*\n?\s*['"`][A-Za-z])/.test(
            window,
          )
        ) {
          hits.push({ file: full, line: i + 1, text: lines[i].trim() });
        }
      }
    }
  }

  for (const root of roots) {
    walk(root);
  }
  return hits;
}
