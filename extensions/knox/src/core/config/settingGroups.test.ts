import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  groupForSetting,
  groupKnoxSettings,
  settingsSearchQuery,
} from "./settingGroups";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(here, "../../../package.json"), "utf8"),
) as { contributes: { configuration: { properties: Record<string, unknown> } | Array<{ properties: Record<string, unknown> }> } };

function contributedIds(): string[] {
  const c = manifest.contributes.configuration;
  const list = Array.isArray(c) ? c : [c];
  return list.flatMap((o) => Object.keys(o.properties ?? {}));
}

describe("grouped settings", () => {
  it("classifies every contributed setting", () => {
    const ungrouped = contributedIds().filter((id) => !groupForSetting(id));
    expect(ungrouped).toEqual([]);
  });

  it("partitions ids without loss or duplication", () => {
    const ids = contributedIds();
    const grouped = groupKnoxSettings(ids).flatMap((g) => g.ids);
    expect(grouped.sort()).toEqual([...ids].sort());
  });

  it("puts unknown ids in Other and builds a search query", () => {
    const g = groupKnoxSettings(["knoxchat.zzz", "knox.checkpoints.autoCleanup"]);
    expect(g.map((x) => x.group.id)).toEqual(["checkpoints", "other"]);
    expect(settingsSearchQuery(["a.b", "c.d"])).toBe("@id:a.b,c.d");
  });
});
