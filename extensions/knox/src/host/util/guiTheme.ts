/**
 * KN-370: native GUI `setTheme` / `setColors` payloads from a converted
 * Monaco theme (`getTheme()` / convertTheme).
 */

export const GUI_THEME_CONFIG_KEYS = [
  "workbench.colorTheme",
  "window.autoDetectColorScheme",
  "window.autoDetectHighContrast",
  "workbench.preferredDarkColorTheme",
  "workbench.preferredLightColorTheme",
  "workbench.preferredHighContrastColorTheme",
  "workbench.preferredHighContrastLightColorTheme",
] as const;

export function affectsGuiTheme(affectsConfiguration: (key: string) => boolean): boolean {
  return GUI_THEME_CONFIG_KEYS.some((key) => affectsConfiguration(key));
}

export function colorsFromConvertedTheme(
  theme: { colors?: Record<string, unknown> } | undefined | null,
): Record<string, string> | undefined {
  const colors = theme?.colors;
  if (!colors || typeof colors !== "object") {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(colors)) {
    if (typeof value === "string" && value.trim()) {
      out[key] = value.trim();
    }
  }
  return Object.keys(out).length ? out : undefined;
}
