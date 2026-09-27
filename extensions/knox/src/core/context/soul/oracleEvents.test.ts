import { describe, expect, it } from "vitest";

import { BuiltInToolNames } from "../../tools/builtIn.js";
import { formatSoulEventContent } from "./extractToolFiles.js";
import { classifyOracleEvent } from "./oracleEvents.js";

describe("classifyOracleEvent", () => {
  it("records build:fail with the gcc error signature", () => {
    const output = [
      "  CC      mm/filemap.o",
      "mm/filemap.c:42:5: error: implicit declaration of function 'copy_to_user'",
      "make: *** [mm/filemap.o] Error 1",
    ].join("\n");
    const event = classifyOracleEvent(BuiltInToolNames.Build, output);
    expect(event?.kind).toBe("build:fail");
    expect(event?.signature).toContain("mm/filemap.c");
    expect(event?.signature).toMatch(/copy_to_user/);
    expect(event?.summary).toContain("build:fail");
    expect(event?.summary).toContain("signature=");
  });

  it("records build:pass when builtin_build is clean", () => {
    const event = classifyOracleEvent(
      BuiltInToolNames.Build,
      "  CC      mm/filemap.o\n  LD      vmlinux",
    );
    expect(event?.kind).toBe("build:pass");
    expect(event?.signature).toBe("ok");
  });

  it("does not treat a successful echo as a build pass", () => {
    expect(
      classifyOracleEvent(
        BuiltInToolNames.RunTerminalCommand,
        "hello from echo",
      ),
    ).toBeUndefined();
  });

  it("records qemu:panic from serial output", () => {
    const output = [
      "Kernel panic - not syncing: Fatal exception",
      "RIP: 0010:copy_to_user+0x10/0x20",
      "Call Trace:",
      " do_fault+0x1c/0x40",
    ].join("\n");
    const event = classifyOracleEvent(BuiltInToolNames.AwaitShell, output);
    expect(event?.kind).toBe("qemu:panic");
    expect(event?.summary).toContain("Kernel panic");
    expect(event?.summary).toMatch(/RIP: copy_to_user\+0x10\/0x20/);
    expect(event?.signature).toMatch(/copy_to_user/);
  });

  it("records bisect:step from git bisect remaining revisions", () => {
    const event = classifyOracleEvent(
      BuiltInToolNames.GitBisect,
      "Bisecting: 3 revisions left to test after this (roughly 2 steps)",
    );
    expect(event?.kind).toBe("bisect:step");
    expect(event?.signature).toBe("3");
    expect(event?.summary).toContain("bisect:step");
  });

  it("formats a soul event so episodic recall sees the gcc signature", () => {
    const event = classifyOracleEvent(
      BuiltInToolNames.Build,
      "mm/filemap.c:42:5: error: implicit declaration of function 'copy_to_user'",
    );
    const content = formatSoulEventContent({
      kind: event!.kind,
      toolName: BuiltInToolNames.Build,
      files: ["mm/filemap.c"],
      ok: false,
      summary: event!.summary,
    });
    expect(content).toContain("[soul build:fail]");
    expect(content).toContain("mm/filemap.c");
    expect(content).toContain("signature=");
    expect(content).not.toMatch(/ran terminal/i);
  });
});
