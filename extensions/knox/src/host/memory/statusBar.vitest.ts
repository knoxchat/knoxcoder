/**
 * Jev editor status bar: hidden while harness judgments are off, even if the
 * vscode `jev.enabled` setting still defaults on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const settings: Record<string, boolean> = {
    "jev.showStatusBar": true,
    "jev.enabled": true,
  };
  const item = {
    name: "",
    command: "",
    text: "",
    tooltip: "",
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  };
  return { settings, item };
});

vi.mock("vscode", () => ({
  StatusBarAlignment: { Left: 1, Right: 2 },
  window: {
    createOutputChannel: () => ({
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    }),
    createStatusBarItem: () => h.item,
  },
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback?: unknown) =>
        Object.prototype.hasOwnProperty.call(h.settings, key)
          ? h.settings[key]
          : fallback,
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
  },
  commands: { registerCommand: () => ({ dispose() {} }) },
  EventEmitter: class {
    event = () => ({ dispose() {} });
    fire() {}
    dispose() {}
  },
}));
vi.mock("../i18n", () => ({ t: (key: string) => key }));
vi.mock("../i18n/guiLanguage", () => ({
  onGuiLanguageChanged: () => ({ dispose() {} }),
}));

import { applyJevConfig } from "core/jev";
import { registerJevStatusBar } from "./statusBar";

function makeContext() {
  return { subscriptions: [] as Array<{ dispose: () => void }> };
}

describe("registerJevStatusBar", () => {
  let context: ReturnType<typeof makeContext>;

  beforeEach(() => {
    applyJevConfig();
    h.settings["jev.showStatusBar"] = true;
    h.settings["jev.enabled"] = true;
    h.item.show.mockClear();
    h.item.hide.mockClear();
    context = makeContext();
  });

  afterEach(() => {
    for (const sub of context.subscriptions) {
      sub.dispose();
    }
    applyJevConfig();
  });

  it("hides while Jev is off even if the vscode setting defaults on", () => {
    registerJevStatusBar(context as never);
    expect(h.item.hide).toHaveBeenCalled();
    expect(h.item.show).not.toHaveBeenCalled();
  });

  it("shows after Jev is enabled", () => {
    registerJevStatusBar(context as never);
    h.item.hide.mockClear();
    h.item.show.mockClear();
    applyJevConfig({ enabled: true });
    expect(h.item.show).toHaveBeenCalled();
    expect(h.item.hide).not.toHaveBeenCalled();
  });

  it("hides when Jev is turned off", () => {
    applyJevConfig({ enabled: true });
    registerJevStatusBar(context as never);
    h.item.hide.mockClear();
    h.item.show.mockClear();
    applyJevConfig({ enabled: false });
    expect(h.item.hide).toHaveBeenCalled();
    expect(h.item.show).not.toHaveBeenCalled();
  });

  it("stays hidden when showStatusBar is false", () => {
    h.settings["jev.showStatusBar"] = false;
    applyJevConfig({ enabled: true });
    registerJevStatusBar(context as never);
    expect(h.item.hide).toHaveBeenCalled();
    expect(h.item.show).not.toHaveBeenCalled();
  });
});
