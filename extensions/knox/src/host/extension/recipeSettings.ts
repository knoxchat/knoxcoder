import * as vscode from "vscode";

import type { RecipeSettings } from "core/protocol/nativeAgent";

/**
 * MC-72: the three recipe flags for the Settings page. They are the real `knoxchat.*` settings, so
 * the Settings UI and `settings.json` always agree. Values are validated here, not trusted.
 */

const AUTO_REPLAY = ["off", "ask", "exact"] as const;

export function readRecipeSettings(): RecipeSettings {
  const cfg = vscode.workspace.getConfiguration("knoxchat");
  const autoReplay = cfg.get<string>("recipes.autoReplay", "off");
  return {
    enabled: cfg.get<boolean>("recipes.enabled", false) === true,
    autoReplay: (AUTO_REPLAY as readonly string[]).includes(autoReplay) ? (autoReplay as RecipeSettings["autoReplay"]) : "off",
    selfImprove: cfg.get<boolean>("selfImprove.enabled", false) === true,
  };
}

export async function writeRecipeSettings(patch: Partial<RecipeSettings>): Promise<RecipeSettings> {
  const cfg = vscode.workspace.getConfiguration("knoxchat");
  const target = vscode.ConfigurationTarget.Global;
  if (typeof patch.enabled === "boolean") await cfg.update("recipes.enabled", patch.enabled, target);
  if (typeof patch.selfImprove === "boolean") await cfg.update("selfImprove.enabled", patch.selfImprove, target);
  if (patch.autoReplay && (AUTO_REPLAY as readonly string[]).includes(patch.autoReplay)) {
    await cfg.update("recipes.autoReplay", patch.autoReplay, target);
  }
  return readRecipeSettings();
}
