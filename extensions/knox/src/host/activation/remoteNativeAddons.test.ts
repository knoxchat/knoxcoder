import * as assert from "node:assert";
import * as path from "node:path";

import {
  decideKnoxRemoteActivation,
  isKnoxRemoteHost,
  isKnoxWebHost,
  knoxManifestAllowsRemoteSsh,
  KNOX_EXTENSION_KIND,
  KNOX_UI_KIND_DESKTOP,
  KNOX_UI_KIND_WEB,
  nodePtyModuleRelPaths,
  probeKnoxNativeAddons,
  ripgrepBinaryRelPaths,
  sqlite3BindingRelPaths,
} from "./remoteNativeAddons";

suite("KN-365 Remote-SSH native addons", () => {
  test("ui + workspace, never web, never a browser entry", () => {
    assert.deepStrictEqual([...KNOX_EXTENSION_KIND], ["ui", "workspace"]);
    assert.deepStrictEqual(
      knoxManifestAllowsRemoteSsh({
        main: "./out/extension",
        extensionKind: ["ui", "workspace"],
      }),
      { ok: true },
    );
    assert.strictEqual(
      knoxManifestAllowsRemoteSsh({
        main: "./out/extension",
        browser: "./out/web",
        extensionKind: ["ui", "workspace"],
      }).ok,
      false,
    );
    assert.strictEqual(
      knoxManifestAllowsRemoteSsh({
        main: "./out/extension",
        extensionKind: ["workspace"],
      }).ok,
      false,
    );
    assert.strictEqual(
      knoxManifestAllowsRemoteSsh({
        main: "./out/extension",
        extensionKind: ["ui", "workspace", "web"],
      }).ok,
      false,
    );
  });

  test("remoteName ssh-remote is remote; empty/local is not", () => {
    assert.strictEqual(isKnoxRemoteHost("ssh-remote"), true);
    assert.strictEqual(isKnoxRemoteHost("wsl"), true);
    assert.strictEqual(isKnoxRemoteHost("local"), false);
    assert.strictEqual(isKnoxRemoteHost(""), false);
    assert.strictEqual(isKnoxRemoteHost(undefined), false);
  });

  test("web UIKind is desktop-only abort", () => {
    assert.strictEqual(isKnoxWebHost(KNOX_UI_KIND_WEB), true);
    assert.strictEqual(isKnoxWebHost(KNOX_UI_KIND_DESKTOP), false);
    assert.deepStrictEqual(
      decideKnoxRemoteActivation({
        uiKind: KNOX_UI_KIND_WEB,
        addons: [],
      }),
      { kind: "abort-web" },
    );
  });

  test("sqlite3 and ripgrep are required on the (remote) extension folder", () => {
    const files = new Set([
      path.posix.join("/ext/knox", sqlite3BindingRelPaths()[0]),
      path.posix.join("/ext/knox", ripgrepBinaryRelPaths("linux")[0]),
      path.posix.join("/ext/knox", nodePtyModuleRelPaths()[0]),
    ]);
    const addons = probeKnoxNativeAddons({
      extensionPath: "/ext/knox",
      platform: "linux",
      exists: (candidate) => files.has(candidate),
      join: path.posix.join,
    });
    assert.deepStrictEqual(
      addons.map((addon) => ({ name: addon.name, found: addon.found, required: addon.required })),
      [
        { name: "sqlite3", found: true, required: true },
        { name: "ripgrep", found: true, required: true },
        { name: "node-pty", found: true, required: false },
      ],
    );
    assert.deepStrictEqual(
      decideKnoxRemoteActivation({
        uiKind: KNOX_UI_KIND_DESKTOP,
        remoteName: "ssh-remote",
        addons,
      }),
      { kind: "ok", remote: true },
    );
  });

  test("missing sqlite3 or ripgrep on SSH is missing-required", () => {
    const addons = probeKnoxNativeAddons({
      extensionPath: "/ext/knox",
      platform: "darwin",
      exists: () => false,
      join: path.posix.join,
    });
    assert.deepStrictEqual(
      decideKnoxRemoteActivation({
        uiKind: KNOX_UI_KIND_DESKTOP,
        remoteName: "ssh-remote",
        addons,
      }),
      {
        kind: "missing-required",
        remote: true,
        missing: ["sqlite3", "ripgrep"],
      },
    );
  });

  test("node-pty may be absent; win32 looks for rg.exe", () => {
    const files = new Set([
      path.win32.join("C:\\ext\\knox", sqlite3BindingRelPaths()[1]),
      path.win32.join("C:\\ext\\knox", ripgrepBinaryRelPaths("win32")[1]),
    ]);
    const addons = probeKnoxNativeAddons({
      extensionPath: "C:\\ext\\knox",
      platform: "win32",
      exists: (candidate) => files.has(candidate),
      join: path.win32.join,
    });
    assert.strictEqual(addons.find((addon) => addon.name === "ripgrep")?.found, true);
    assert.strictEqual(addons.find((addon) => addon.name === "node-pty")?.found, false);
    assert.deepStrictEqual(
      decideKnoxRemoteActivation({
        uiKind: KNOX_UI_KIND_DESKTOP,
        remoteName: undefined,
        addons,
      }),
      { kind: "ok", remote: false },
    );
    assert.ok(ripgrepBinaryRelPaths("win32").every((rel) => rel.endsWith("rg.exe")));
  });
});
