import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, describe, expect, it } from "vitest";

import {
  gitRemoteIsTrusted,
  readGitRemoteUrls,
  resolveDefaultPermissionMode,
  resolveWorkspacePermissionMode,
  workspaceHasKnoxSessions,
} from "./sessionPermission";

const prevGlobal = process.env.KNOX_GLOBAL_DIR;

afterEach(() => {
  if (prevGlobal === undefined) {
    delete process.env.KNOX_GLOBAL_DIR;
  } else {
    process.env.KNOX_GLOBAL_DIR = prevGlobal;
  }
});

describe("resolveDefaultPermissionMode", () => {
  it("saved mode wins", () => {
    expect(
      resolveDefaultPermissionMode({
        savedMode: "fullAuto",
        setting: "ask",
        hasKnoxProjectState: false,
        gitRemoteAllowlisted: false,
      }),
    ).toEqual({ mode: "fullAuto", reason: "saved" });
  });

  it("setting overrides the heuristic", () => {
    expect(
      resolveDefaultPermissionMode({
        setting: "ask",
        hasKnoxProjectState: true,
        gitRemoteAllowlisted: true,
      }),
    ).toEqual({ mode: "default", reason: "setting" });
    expect(
      resolveDefaultPermissionMode({
        setting: "edits",
        hasKnoxProjectState: false,
        gitRemoteAllowlisted: false,
      }),
    ).toEqual({ mode: "acceptEdits", reason: "setting" });
  });

  it("known project and trusted remotes stay Auto; fresh clones start Ask", () => {
    expect(
      resolveDefaultPermissionMode({
        hasKnoxProjectState: true,
        gitRemoteAllowlisted: false,
      }),
    ).toEqual({ mode: "fullAuto", reason: "known_project" });
    expect(
      resolveDefaultPermissionMode({
        hasKnoxProjectState: false,
        gitRemoteAllowlisted: true,
      }),
    ).toEqual({ mode: "fullAuto", reason: "trusted_remote" });
    expect(
      resolveDefaultPermissionMode({
        hasKnoxProjectState: false,
        gitRemoteAllowlisted: false,
      }),
    ).toEqual({ mode: "default", reason: "fresh_clone" });
  });
});

describe("workspace disk heuristic", () => {
  it("detects prior sessions and trusted remotes without creating ~/.knoxcoder", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "knox-k090-"));
    const knox = path.join(root, "knox-home");
    const repo = path.join(root, "linux");
    fs.mkdirSync(path.join(knox, "sessions"), { recursive: true });
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, ".git", "config"),
      '[remote "origin"]\n\turl = git@github.com:torvalds/linux.git\n',
    );
    process.env.KNOX_GLOBAL_DIR = knox;
    expect(workspaceHasKnoxSessions(repo)).toBe(false);
    expect(readGitRemoteUrls(repo)).toEqual([
      "git@github.com:torvalds/linux.git",
    ]);
    expect(
      gitRemoteIsTrusted(readGitRemoteUrls(repo), [
        "github.com/torvalds/linux",
      ]),
    ).toBe(true);
    expect(
      resolveWorkspacePermissionMode(repo, {
        trustedGitRemotes: ["github.com/torvalds/linux"],
      }).reason,
    ).toBe("trusted_remote");

    fs.writeFileSync(
      path.join(knox, "sessions", "sessions.json"),
      JSON.stringify([{ sessionId: "s1", workspaceDirectory: repo }]),
    );
    expect(workspaceHasKnoxSessions(repo)).toBe(true);
    expect(resolveWorkspacePermissionMode(repo).reason).toBe("known_project");
    expect(fs.existsSync(path.join(root, ".knoxcoder"))).toBe(false);
  });

  it("starts Ask on a brand-new temp repo", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "knox-k090-fresh-"));
    process.env.KNOX_GLOBAL_DIR = path.join(root, "knox-home");
    const repo = path.join(root, "clone");
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, ".git", "config"),
      '[remote "origin"]\n\turl = https://evil.example/payload.git\n',
    );
    expect(resolveWorkspacePermissionMode(repo)).toEqual({
      mode: "default",
      reason: "fresh_clone",
    });
  });
});
