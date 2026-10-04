import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { EXTENSION_NAME } from "./extensionName";
import {
  contributedKnoxKeybindingCommands,
  contributedKnoxSettingIds,
  knoxManifestConfigurationProperties,
  KNOX_CHAT_SETTING_IDS,
  KNOX_CHECKPOINT_SETTING_IDS,
  KNOX_CHECKPOINTS_SECTION,
  KNOX_SETTING_IDS,
  KNOX_SETTINGS_SECTION,
  KNOX_SYNC_KEYBINDING_COMMANDS,
} from "./settingIds";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../../..");
const knoxPackagePath = join(repoRoot, "extensions/knox/package.json");

type KnoxManifest = {
  contributes?: {
    configuration?:
      | { properties?: Record<string, unknown> }
      | Array<{ properties?: Record<string, unknown> }>;
    keybindings?: Array<{ command?: string }>;
  };
};

function readManifest(path: string): KnoxManifest {
  return JSON.parse(readFileSync(path, "utf8")) as KnoxManifest;
}

describe("KN-382 setting ids stay in extensions/knox/package.json", () => {
  const manifest = readManifest(knoxPackagePath);
  const contributed = contributedKnoxSettingIds(
    knoxManifestConfigurationProperties(manifest.contributes?.configuration),
  );

  it("settings section ids stay knoxchat / knox.checkpoints", () => {
    expect(KNOX_SETTINGS_SECTION).toBe("knoxchat");
    expect(KNOX_CHECKPOINTS_SECTION).toBe("knox.checkpoints");
    expect(EXTENSION_NAME).toBe("knoxchat");
  });

  it("contributes every frozen knoxchat.* and knox.checkpoints.* id", () => {
    expect(contributed).toEqual([...KNOX_SETTING_IDS].sort());
    expect(KNOX_CHAT_SETTING_IDS).toHaveLength(23);
    expect(KNOX_CHECKPOINT_SETTING_IDS).toHaveLength(35);
  });

  it("does not contribute renamed knoxchat.* or knox.checkpoints.* ids", () => {
    const extra = contributed.filter(
      (id) => !(KNOX_SETTING_IDS as readonly string[]).includes(id),
    );
    expect(extra).toEqual([]);
  });

  it("keeps knoxchat.* and knox.checkpoints.* keybinding command ids", () => {
    const commands = contributedKnoxKeybindingCommands(
      manifest.contributes?.keybindings,
    );
    expect(commands).toEqual([...KNOX_SYNC_KEYBINDING_COMMANDS].sort());
  });
});
