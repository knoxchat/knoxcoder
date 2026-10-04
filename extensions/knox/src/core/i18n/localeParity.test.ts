import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import i18next from "i18next";
import { describe, expect, it } from "vitest";

import { t as coreT } from "./index.js";
import {
  compareGuiLocaleModules,
  compareLocaleDirs,
  compareLocaleObjects,
  findHardcodedUserMessages,
  flattenLocale,
} from "./localeParity.js";

const here = path.dirname(fileURLToPath(import.meta.url));
/** `extensions/knox/src/core/i18n` → `extensions/knox/src` */
const srcRoot = path.resolve(here, "../..");
/** KnoxCoder repo root: `extensions/knox/src/core/i18n` → five levels up. */
const repoRoot = path.resolve(here, "../../../../..");

const LOCALE_PACKAGES = [
  {
    name: "core",
    en: path.join(srcRoot, "core/i18n/locales/en"),
    zh: path.join(srcRoot, "core/i18n/locales/zh"),
  },
  {
    name: "host",
    en: path.join(srcRoot, "host/i18n/locales/en"),
    zh: path.join(srcRoot, "host/i18n/locales/zh"),
  },
] as const;

function formatDrifts(
  drifts: Array<{ file: string; missingInZh: string[]; missingInEn: string[] }>,
): string {
  return drifts
    .map((d) => {
      const parts: string[] = [`${d.file}:`];
      if (d.missingInZh.length) {
        parts.push(`  missing in zh: ${d.missingInZh.join(", ")}`);
      }
      if (d.missingInEn.length) {
        parts.push(`  missing in en: ${d.missingInEn.join(", ")}`);
      }
      return parts.join("\n");
    })
    .join("\n");
}

describe("en/zh locale key parity", () => {
  it("flattenLocale handles nested objects", () => {
    expect(flattenLocale({ a: { b: "x" }, c: "y" })).toEqual({
      "a.b": "x",
      c: "y",
    });
  });

  for (const pkg of LOCALE_PACKAGES) {
    it(`${pkg.name} en/zh keys match`, () => {
      const drifts = compareLocaleDirs(pkg.en, pkg.zh);
      if (drifts.length) {
        expect.fail(`Locale key drift in ${pkg.name}:\n${formatDrifts(drifts)}`);
      }
    });
  }

  it("native GUI en/zh tables have the same keys (KN-381)", () => {
    const dir = path.join(
      repoRoot,
      "src/vs/workbench/contrib/knox/browser/gui/i18n",
    );
    const drifts = compareGuiLocaleModules(
      path.join(dir, "en"),
      path.join(dir, "zh"),
    );
    if (drifts.length) {
      expect.fail(`Locale key drift in native GUI:\n${formatDrifts(drifts)}`);
    }
  });

  it("package.nls.json en/zh keys match", () => {
    const knoxExt = path.join(repoRoot, "extensions/knox");
    const en = JSON.parse(
      fs.readFileSync(path.join(knoxExt, "package.nls.json"), "utf8"),
    ) as Record<string, unknown>;
    const zh = JSON.parse(
      fs.readFileSync(path.join(knoxExt, "package.nls.zh-cn.json"), "utf8"),
    ) as Record<string, unknown>;
    const drift = compareLocaleObjects("package.nls", en, zh);
    if (drift) {
      expect.fail(`Locale key drift in package.nls:\n${formatDrifts([drift])}`);
    }
  });
});

describe("core i18n instance isolation (KN-381)", () => {
  it("does not share the process-wide i18next singleton", () => {
    expect(coreT("newChat")).toBe("New Chat");
    expect(i18next.t("newChat")).not.toBe("New Chat");
  });
});

describe("no raw English show*Message in agent/checkpoints", () => {
  it("requires t() for user-facing notifications", () => {
    const roots = [
      path.join(srcRoot, "host/agent"),
      path.join(srcRoot, "host/checkpoints"),
    ];
    const hits = findHardcodedUserMessages(roots);
    if (hits.length) {
      const detail = hits
        .map((h) => `${path.relative(srcRoot, h.file)}:${h.line}: ${h.text}`)
        .join("\n");
      expect.fail(
        `Hardcoded English user messages (use t("key") or mark // i18n-allow):\n${detail}`,
      );
    }
  });
});
