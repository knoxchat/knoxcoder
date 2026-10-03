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
});
