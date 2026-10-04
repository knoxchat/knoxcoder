import { describe, expect, it } from "vitest";

import {
  bwrapArgv,
  detectSandboxBackend,
  macosSeatbeltProfile,
  resolveSandboxMode,
  shSingleQuote,
  wrapSandboxCommand,
} from "./sandbox";

describe("sandbox wrap (P1-2)", () => {
  it("parses modes and env override", () => {
    expect(resolveSandboxMode("read-only")).toBe("read-only");
    expect(resolveSandboxMode("nope")).toBe("off");
    const prev = process.env.KNOX_SANDBOX;
    process.env.KNOX_SANDBOX = "workspace-write";
    expect(resolveSandboxMode("off")).toBe("workspace-write");
    if (prev === undefined) {
      delete process.env.KNOX_SANDBOX;
    } else {
      process.env.KNOX_SANDBOX = prev;
    }
  });

  it("quotes for the outer shell", () => {
    expect(shSingleQuote("a'b")).toBe(`'a'\\''b'`);
  });

  it("off is a no-op", () => {
    const r = wrapSandboxCommand("echo hi", {
      mode: "off",
      workspaceRoot: "/repo",
    });
    expect(r).toMatchObject({ command: "echo hi", sandboxed: false, backend: "none" });
  });

  it("builds a seatbelt profile that allows workspace writes and can deny network", () => {
    const profile = macosSeatbeltProfile({
      mode: "workspace-write",
      workspaceRoot: "/Users/me/proj",
      tmpDirs: ["/tmp"],
      denyNetwork: true,
    });
    expect(profile).toContain('(subpath "/Users/me/proj")');
    expect(profile).toContain('(subpath "/tmp")');
    expect(profile).toContain("(deny network*)");
    expect(profile).toContain("(deny file-write*)");
  });

  it("read-only seatbelt does not allow workspace writes", () => {
    const profile = macosSeatbeltProfile({
      mode: "read-only",
      workspaceRoot: "/Users/me/proj",
      tmpDirs: ["/tmp"],
      denyNetwork: false,
    });
    expect(profile).not.toContain("/Users/me/proj");
    expect(profile).toContain("/tmp");
  });

  it("wraps with sandbox-exec when the binary exists", () => {
    const r = wrapSandboxCommand("echo hi", {
      mode: "workspace-write",
      workspaceRoot: "/repo",
      platform: "darwin",
      hasBinary: (n) => n === "sandbox-exec",
      tmpDirs: ["/tmp"],
    });
    expect(r.sandboxed).toBe(true);
    expect(r.backend).toBe("sandbox-exec");
    expect(r.command).toMatch(/^sandbox-exec -p /);
    expect(r.command).toContain("/bin/sh -c");
  });

  it("wraps with bwrap on linux", () => {
    const r = wrapSandboxCommand("make -j4", {
      mode: "workspace-write",
      workspaceRoot: "/src/linux",
      platform: "linux",
      hasBinary: (n) => n === "bwrap",
      tmpDirs: ["/tmp"],
      denyNetwork: true,
    });
    expect(r.sandboxed).toBe(true);
    expect(r.backend).toBe("bwrap");
    expect(r.command).toContain("bwrap");
    expect(r.command).toContain("--unshare-net");
    expect(r.command).toContain("/src/linux");
  });

  it("bwrap argv binds workspace only in workspace-write", () => {
    const write = bwrapArgv({
      mode: "workspace-write",
      workspaceRoot: "/ws",
      tmpDirs: ["/tmp"],
      denyNetwork: false,
    });
    const ro = bwrapArgv({
      mode: "read-only",
      workspaceRoot: "/ws",
      tmpDirs: ["/tmp"],
      denyNetwork: false,
    });
    expect(write.filter((a, i) => a === "/ws" || write[i - 1] === "--bind")).toContain("/ws");
    expect(ro.includes("/ws")).toBe(false);
  });

  it("windows is unsupported and warns unless required", () => {
    const r = wrapSandboxCommand("echo hi", {
      mode: "workspace-write",
      workspaceRoot: "C:\\repo",
      platform: "win32",
    });
    expect(r.sandboxed).toBe(false);
    expect(r.backend).toBe("unsupported");
    expect(r.warning).toMatch(/Windows/);
    expect(() =>
      wrapSandboxCommand("echo hi", {
        mode: "workspace-write",
        workspaceRoot: "C:\\repo",
        platform: "win32",
        required: true,
      }),
    ).toThrow(/Windows/);
  });

  it("detects missing binaries", () => {
    expect(detectSandboxBackend("darwin", () => false)).toBe("missing");
    expect(detectSandboxBackend("linux", () => false)).toBe("missing");
    expect(detectSandboxBackend("win32", () => true)).toBe("unsupported");
  });
});
