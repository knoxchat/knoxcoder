import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { clearSession, loadSession, resolveSession, saveSession } from "./credentials";

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

  it("never prints the key: credential sources do not log session secrets", () => {
    const src = fs.readFileSync(path.join(__dirname, "credentials.ts"), "utf-8");
    expect(src).not.toMatch(/(console\.\w+|stderr\.write|stdout\.write)\([^)]*(apiKey|refreshToken)/);
  });

  it("loads the OAuth session file and ignores KNOX_API_KEY", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-cred-"));
    const file = path.join(dir, "auth.json");
    saveSession(
      {
        apiKey: "from-oauth",
        account: { userId: 1, username: "file", tokenId: 2, connectedAt: 3 },
      },
      file,
    );
    const prev = process.env.KNOX_API_KEY;
    process.env.KNOX_API_KEY = "from-env";
    try {
      const session = resolveSession(file);
      expect(session?.apiKey).toBe("from-oauth");
      expect(session?.account.username).toBe("file");
      expect(resolveSession(path.join(dir, "missing.json"))).toBeUndefined();
    } finally {
      if (prev === undefined) {
        delete process.env.KNOX_API_KEY;
      } else {
        process.env.KNOX_API_KEY = prev;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
