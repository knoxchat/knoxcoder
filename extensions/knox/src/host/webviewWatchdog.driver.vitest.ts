/**
 * Drives the real KnoxGUIWebviewViewProvider watchdog loop with fake timers:
 * a renderer that stops heartbeating is reloaded, then replaced by the crash
 * placeholder, and the placeholder's Reload button recovers it. This is the
 * no-Electron stand-in for a real renderer-crash test.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const handlers = new Map<string, (m?: unknown) => void>();
  const state = { focused: true, mode: 1 };
  const windowStateListeners: Array<(s: { focused: boolean }) => void> = [];
  return { handlers, state, windowStateListeners };
});

vi.mock("vscode", () => {
  const d = { dispose() {} };
  return {
    ExtensionMode: { Production: 1, Development: 2, Test: 3 },
    window: {
      state: h.state,
      onDidChangeActiveColorTheme: () => d,
      onDidChangeWindowState: (fn: (s: { focused: boolean }) => void) => {
        h.windowStateListeners.push(fn);
        return d;
      },
    },
    workspace: { onDidChangeConfiguration: () => d },
    EventEmitter: class {
      event = () => d;
      fire() {}
    },
  };
});
vi.mock("./i18n", () => ({ t: (k: string) => k }));
vi.mock("./util/getTheme", () => ({ getTheme: () => ({}) }));
vi.mock("./util/guiTheme", () => ({
  affectsGuiTheme: () => false,
  colorsFromConvertedTheme: () => undefined,
}));
vi.mock("./util/vscode", () => ({
  getNonce: () => "nonce",
  useKnoxViteDevServer: () => false,
}));
vi.mock("./webviewHtml", () => ({
  applyKnoxWebviewOptions: () => {},
  renderKnoxWebviewHtml: () => "<html>app</html>",
  WEBVIEW_HEARTBEAT_INTERVAL_MS: 5000,
}));
vi.mock("./webviewProtocol", () => ({
  VsCodeWebviewProtocol: class {
    webview: unknown;
    on(type: string, fn: (m?: unknown) => void) {
      h.handlers.set(type, fn);
    }
    send() {}
  },
}));

import { KnoxGUIWebviewViewProvider } from "./KnoxGUIWebviewViewProvider";
import { WEBVIEW_HEARTBEAT_INTERVAL_MS } from "./webviewWatchdog";

function makeView(visible = true) {
  const visListeners: Array<() => void> = [];
  return {
    visible,
    webview: { html: "" },
    onDidChangeVisibility: (fn: () => void) => {
      visListeners.push(fn);
      return { dispose() {} };
    },
  };
}

function makeProvider() {
  return new KnoxGUIWebviewViewProvider(
    Promise.resolve({} as never),
    "win",
    { extensionMode: 1, extensionUri: {} } as never,
  );
}

const tick = (ms: number) => vi.advanceTimersByTime(ms);
const beat = () => h.handlers.get("knox/heartbeat")!();

describe("webview watchdog driver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.state.focused = true;
    h.handlers.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("healthy heartbeats never reload", () => {
    const p = makeProvider();
    const view = makeView();
    p.resolveWebviewView(view as never, {} as never, {} as never);
    for (let i = 0; i < 60; i++) {
      tick(WEBVIEW_HEARTBEAT_INTERVAL_MS);
      beat();
    }
    expect(view.webview.html).toBe("<html>app</html>");
  });

  it("dead renderer: reloads, then shows the crash placeholder, and Reload recovers", () => {
    const p = makeProvider();
    const view = makeView();
    p.resolveWebviewView(view as never, {} as never, {} as never);
    const sets: string[] = [];
    let html = view.webview.html;
    Object.defineProperty(view.webview, "html", {
      get: () => html,
      set: (v: string) => {
        html = v;
        sets.push(v);
      },
    });

    // No heartbeats at all (renderer crashed): run well past reload + backoff.
    tick(10 * 60_000);
    const reloads = sets.filter((s) => s === "<html>app</html>").length;
    expect(reloads).toBe(2); // WEBVIEW_MAX_RELOADS
    expect(html).toContain('id="reload"');
    expect(html).toContain("knox/reloadWebview");

    // Placeholder is stable: no storm of further writes.
    const writes = sets.length;
    tick(10 * 60_000);
    expect(sets.length).toBe(writes);

    // User clicks Reload in the placeholder.
    h.handlers.get("knox/reloadWebview")!();
    expect(html).toBe("<html>app</html>");

    // Renderer is healthy again.
    for (let i = 0; i < 20; i++) {
      tick(WEBVIEW_HEARTBEAT_INTERVAL_MS);
      beat();
    }
    expect(html).toBe("<html>app</html>");
  });

  it("a hidden sidebar is never treated as a crash", () => {
    const p = makeProvider();
    const view = makeView(false);
    p.resolveWebviewView(view as never, {} as never, {} as never);
    tick(30 * 60_000);
    expect(view.webview.html).toBe("<html>app</html>");
  });

  it("an unfocused window is never treated as a crash", () => {
    h.state.focused = true;
    const p = makeProvider();
    const view = makeView();
    p.resolveWebviewView(view as never, {} as never, {} as never);
    for (const fn of h.windowStateListeners) fn({ focused: false });
    tick(30 * 60_000);
    expect(view.webview.html).toBe("<html>app</html>");
  });
});
