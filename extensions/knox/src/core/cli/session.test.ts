import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  continueCliSession,
  loadCliSession,
  messagesFromSession,
  saveCliSession,
  sessionFromMessages,
  withFinalAssistant,
} from "./session";

const prev = process.env.KNOX_GLOBAL_DIR;
const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  if (prev === undefined) {
    delete process.env.KNOX_GLOBAL_DIR;
  } else {
    process.env.KNOX_GLOBAL_DIR = prev;
  }
});

function tmpGlobal(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "knox-sess-"));
  dirs.push(d);
  process.env.KNOX_GLOBAL_DIR = d;
  return d;
}

describe("CLI session resume", () => {
  it("round-trips messages and continue finds the newest", () => {
    tmpGlobal();
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "knox-ws-"));
    dirs.push(workspace);
    const first = sessionFromMessages({
      workspaceDir: workspace,
      task: "first task",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "first task" },
        { role: "assistant", content: "done" },
      ],
    });
    saveCliSession(first);
    const loaded = loadCliSession(first.sessionId);
    expect(messagesFromSession(loaded).map((m) => m.role)).toEqual([
      "user",
      "assistant",
    ]);
    const continued = continueCliSession(workspace);
    expect(continued.sessionId).toBe(first.sessionId);
  });

  it("throws when the session id is unknown", () => {
    tmpGlobal();
    expect(() => loadCliSession("no-such-session")).toThrow(/not found/);
  });

  it("appends a missing final assistant from the summary", () => {
    const messages = withFinalAssistant(
      [{ role: "user", content: "hi" }],
      "hello from first",
    );
    expect(messages.at(-1)).toEqual({
      role: "assistant",
      content: "hello from first",
    });
  });
});
