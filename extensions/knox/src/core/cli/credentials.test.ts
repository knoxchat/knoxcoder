import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { clearSession, loadSession, saveSession } from "./credentials";

describe("cli credentials", () => {
  it("round-trips a session with 0600 permissions and clears it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-cred-"));
    const file = path.join(dir, "sub", "auth.json");
    expect(loadSession(file)).toBeUndefined();
    const session = {
      apiKey: "sk-test",
      refreshToken: "r",
      account: { userId: 1, username: "knox", tokenId: 2, connectedAt: 3 },
    };
    saveSession(session, file);
    expect(loadSession(file)).toEqual(session);
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
    clearSession(file);
    expect(loadSession(file)).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("treats a corrupt file as signed out", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-cred-"));
    const file = path.join(dir, "auth.json");
    fs.writeFileSync(file, "{nope");
    expect(loadSession(file)).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.skipIf(process.platform === "win32")("tightens a world-readable file on load and leaves no temp files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-cred-"));
    const file = path.join(dir, "auth.json");
    const session = {
      apiKey: "sk-test",
      account: { userId: 1, username: "knox", tokenId: 2, connectedAt: 3 },
    };
    saveSession(session, file);
    fs.chmodSync(file, 0o644);
    expect(loadSession(file)).toEqual(session);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    saveSession(session, file);
    expect(fs.readdirSync(dir)).toEqual(["auth.json"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("never prints the key: CLI sources do not log session secrets", () => {
    for (const f of ["main.ts", "credentials.ts", "headless.ts"]) {
      const src = fs.readFileSync(path.join(__dirname, f), "utf-8");
      expect(src).not.toMatch(/(console\.\w+|stderr\.write|stdout\.write)\([^)]*(apiKey|refreshToken)/);
    }
  });
});
