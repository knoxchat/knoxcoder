/**
 * P1-9 theme check (static): text colours in the native chat UI CSS must stay readable on
 * Light Modern / High Contrast Light as well as the dark themes.
 *
 *  - A `color: <hex>` literal that is under 4.5:1 on white must have a light-theme override
 *    in `knoxGui.css` (the "Light-theme text contrast" block) or sit in a light-scoped rule.
 *  - The brand teal `#159994` is 3.5:1 on white, so text must use `var(--knox-accent, ...)`,
 *    which the light theme remaps to `#0f7a76` (5.2:1).
 *  - Overrides themselves must meet 4.5:1 on white and on the Solarized Light background.
 *
 * This reads the CSS from the repo; it is skipped when the extension is built outside it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
let dir = here;
let mediaDir = "";
for (let i = 0; i < 10; i++) {
  const candidate = path.join(dir, "src/vs/workbench/contrib/knox/browser/media");
  if (fs.existsSync(candidate)) {
    mediaDir = candidate;
    break;
  }
  dir = path.dirname(dir);
}

function cssFiles(base: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    const full = path.join(base, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(full));
    else if (entry.name.endsWith(".css")) out.push(full);
  }
  return out;
}

function luminance(hex: string): number {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const LIGHT_SCOPE = /vscode-light|high-contrast-light|theme-kind="light"|\.vs\b|is-light/;
/** `:not(light...)` marks a dark-only rule; it must not count as light-scoped. */
function isLightScoped(selector: string): boolean {
  let s = selector;
  for (let i = 0; i < 4; i++) s = s.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, "");
  return LIGHT_SCOPE.test(s);
}

function isDarkOnly(selector: string): boolean {
  return /:not\([^)]*(?:vscode-light|high-contrast-light|theme-kind="light")/.test(selector);
}

const COLOR_RE = /(?<![-\w])color\s*:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\s*(?:!important)?\s*;/;

interface Rule {
  file: string;
  line: number;
  selector: string;
  color?: string;
}

function rulesOf(file: string): Rule[] {
  const css = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const rules: Rule[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (selector.startsWith("@")) continue;
    rules.push({
      file: path.basename(file),
      line: css.slice(0, m.index).split("\n").length,
      selector,
      color: COLOR_RE.exec(m[2])?.[1].toLowerCase(),
    });
  }
  return rules;
}

const suite = mediaDir ? describe : describe.skip;

suite("native GUI theme contrast (P1-9)", () => {
  const files = mediaDir ? cssFiles(mediaDir) : [];
  const all = files.flatMap(rulesOf);
  const lightSelectors = all.filter((r) => isLightScoped(r.selector)).map((r) => r.selector);

  it("light overrides meet 4.5:1 on light backgrounds", () => {
    const bad = all
      .filter((r) => r.color && isLightScoped(r.selector))
      .filter((r) => contrast(r.color!, "#ffffff") < 4.5 || contrast(r.color!, "#fdf6e3") < 4.0)
      .map((r) => `${r.file}:${r.line} ${r.selector} ${r.color}`);
    expect(bad).toEqual([]);
  });

  it("no low-contrast text literal lacks a light override", () => {
    const missing: string[] = [];
    for (const r of all) {
      if (!r.color || isLightScoped(r.selector) || isDarkOnly(r.selector)) continue;
      const c = r.color;
      // Near-white text is used on coloured fills (buttons, badges); not a light-bg risk here.
      if (luminance(c) > 0.9 || contrast(c, "#ffffff") >= 4.5) continue;
      for (const part of r.selector.split(",").map((p) => p.trim()).filter(Boolean)) {
        const lastClass = part.match(/\.[\w-]+/g)?.pop() ?? part;
        if (!lightSelectors.some((s) => s.includes(lastClass))) {
          missing.push(`${r.file}:${r.line} ${part} ${c} (${contrast(c, "#ffffff").toFixed(1)}:1)`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("brand teal text goes through --knox-accent so light themes darken it", () => {
    const offenders: string[] = [];
    for (const r of all) {
      if (r.color === "#159994" && !isLightScoped(r.selector) && !isDarkOnly(r.selector)) {
        offenders.push(`${r.file}:${r.line} ${r.selector}`);
      }
    }
    expect(offenders).toEqual([]);
    const gui = fs.readFileSync(path.join(mediaDir, "knoxGui.css"), "utf8");
    expect(gui).toMatch(/--knox-accent:\s*#0f7a76/);
    expect(contrast("#0f7a76", "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
});
