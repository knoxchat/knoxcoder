import * as assert from "node:assert";

import {
  affectsGuiTheme,
  colorsFromConvertedTheme,
  GUI_THEME_CONFIG_KEYS,
} from "./guiTheme";

suite("KN-370 GUI theme host payloads", () => {
  test("theme config keys cover workbench + auto-detect prefs", () => {
    assert.ok(GUI_THEME_CONFIG_KEYS.includes("workbench.colorTheme"));
    assert.ok(GUI_THEME_CONFIG_KEYS.includes("window.autoDetectColorScheme"));
    assert.strictEqual(
      affectsGuiTheme((key) => key === "workbench.colorTheme"),
      true,
    );
    assert.strictEqual(
      affectsGuiTheme((key) => key === "editor.fontSize"),
      false,
    );
  });

  test("colorsFromConvertedTheme copies string color ids", () => {
    assert.strictEqual(colorsFromConvertedTheme(undefined), undefined);
    assert.strictEqual(colorsFromConvertedTheme({}), undefined);
    assert.deepStrictEqual(
      colorsFromConvertedTheme({
        colors: {
          "editor.background": "#1e1e1e",
          "editor.foreground": 1 as unknown as string,
          empty: "  ",
        },
      }),
      { "editor.background": "#1e1e1e" },
    );
  });
});
