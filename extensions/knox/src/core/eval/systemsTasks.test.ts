import { afterEach, describe, expect, it } from "vitest";

import { BuiltInToolNames } from "../tools/builtIn";
import {
  diagnosticSignature,
  parseBuildOutput,
} from "../tools/build/parseDiagnostics";
import { resetPlansForTests } from "../tools/planStore";
import { runAgentEval, SYSTEMS_EVAL_CATALOG, createEvalIde } from "./harness";
import { loadCodebaseCard } from "../context/codebaseCard";

const FOO_BUG = `int main(void) {
  bar();
  return 0;
}
`;

const FOO_FIXED = `int bar(void);

int main(void) {
  bar();
  return 0;
}
`;

function evalMakeFromWorkspace(files: Record<string, string>) {
  const src = files["src/foo.c"] ?? "";
  const implicit = /bar\s*\(/.test(src) && !/int bar\s*\(/.test(src);
  if (implicit) {
    const log = [
      "Command: make",
      "Status: exited",
      "Exit: 1",
      "Cwd: /tmp/knox-eval-ws",
      "--- stdout ---",
      "src/foo.c:2:3: error: implicit declaration of function 'bar'",
      "make: *** [src/foo.o] Error 1",
    ].join("\n");
    return [
      {
        name: "Terminal",
        description: "Terminal command exited 1",
        content: log,
      },
    ];
  }
  return [
    {
      name: "Terminal",
      description: "Terminal command exited 0",
      content: [
        "Command: make",
        "Status: exited",
        "Exit: 0",
        "Cwd: /tmp/knox-eval-ws",
        "--- stdout ---",
        "  CC src/foo.o",
      ].join("\n"),
    },
  ];
}

describe("systems golden tasks", () => {
  it("glob finds nested C files (listDir recursion)", async () => {
    const result = await runAgentEval({
      prompt: "Find the C sources.",
      catalog: SYSTEMS_EVAL_CATALOG,
      workspace: {
        Makefile: "all:\n",
        "arch/x86/foo.c": "void foo(void) {}\n",
      },
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.Glob,
              args: { pattern: "**/*.c" },
            },
          ],
        },
        { content: "Found arch/x86/foo.c." },
      ],
    });

    expect(result.stoppedReason).toBe("completed");
    expect(result.toolTrace[0]?.ok).toBe(true);
    expect(result.toolTrace[0]?.output).toContain("arch/x86/foo.c");
  });

  it("glob honors .gitignore generated/ (HL-19)", async () => {
    const result = await runAgentEval({
      prompt: "Find C sources.",
      catalog: SYSTEMS_EVAL_CATALOG,
      workspace: {
        ".gitignore": "generated/\n*.ko\nvmlinux\n",
        Makefile: "all:\n",
        "mm/filemap.c": "void filemap(void) {}\n",
        "generated/foo.c": "void generated(void) {}\n",
        "mm/filemap.ko": "ELF\n",
        vmlinux: "ELF\n",
      },
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.Glob,
              args: { pattern: "**/*.c" },
            },
          ],
        },
        { content: "Only mm/filemap.c." },
      ],
    });
    expect(result.stoppedReason).toBe("completed");
    expect(result.toolTrace[0]?.output).toContain("mm/filemap.c");
    expect(result.toolTrace[0]?.output).not.toContain("generated/foo.c");
  });

  it("exact_search greps in-memory files", async () => {
    const result = await runAgentEval({
      prompt: "Search for copy_process.",
      catalog: SYSTEMS_EVAL_CATALOG,
      workspace: {
        "kernel/fork.c": "pid_t copy_process(void) { return 0; }\n",
      },
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.ExactSearch,
              args: { query: "copy_process" },
            },
          ],
        },
        { content: "It's in kernel/fork.c." },
      ],
    });

    expect(result.toolTrace[0]?.ok).toBe(true);
    expect(result.toolTrace[0]?.output).toContain("copy_process");
    expect(result.toolTrace[0]?.output).toContain("kernel/fork.c");
  });

  it("view_subdirectory lists nested arch/x86", async () => {
    const result = await runAgentEval({
      prompt: "Show arch.",
      catalog: SYSTEMS_EVAL_CATALOG,
      workspace: {
        "arch/x86/foo.c": "void foo(void) {}\n",
      },
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.ViewSubdirectory,
              args: { directory_path: "arch", depth: 3 },
            },
          ],
        },
        { content: "arch/x86/foo.c is there." },
      ],
    });

    expect(result.toolTrace[0]?.ok).toBe(true);
    expect(result.toolTrace[0]?.output).toMatch(/foo\.c/);
  });

  it("gcc-fix: builtin_build fail → StrReplace → builtin_build pass", async () => {
    const result = await runAgentEval({
      prompt: "Fix the implicit declaration so make succeeds.",
      catalog: SYSTEMS_EVAL_CATALOG,
      workspace: { "src/foo.c": FOO_BUG, Makefile: "all:\n\t$(CC) -c src/foo.c\n" },
      evaluateCommand: async (_args, files) => evalMakeFromWorkspace(files),
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.Build,
              args: { target: "all" },
            },
          ],
        },
        {
          toolCalls: [
            {
              name: BuiltInToolNames.EditFile,
              args: {
                filepath: "src/foo.c",
                old_string: "int main(void) {",
                new_string: "int bar(void);\n\nint main(void) {",
              },
            },
          ],
        },
        {
          toolCalls: [
            {
              name: BuiltInToolNames.Build,
              args: { target: "all" },
            },
          ],
        },
        { content: "Declared bar(); make is clean." },
      ],
    });

    expect(result.stoppedReason).toBe("completed");
    expect(result.toolTrace[0]?.name).toBe(BuiltInToolNames.Build);
    expect(result.toolTrace[0]?.output).toMatch(/Exit: 1/);
    expect(result.toolTrace[0]?.output).toContain("implicit declaration");
    expect(result.toolTrace[0]?.output).toContain("Build diagnostics");
    expect(
      parseBuildOutput(result.toolTrace[0]?.output ?? "").errors[0]?.file,
    ).toBe("src/foo.c");
    expect(result.toolTrace[2]?.output).toMatch(/Exit: 0/);
    expect(result.toolTrace[2]?.output).toMatch(/clean/);
    expect(result.files["src/foo.c"]).toBe(FOO_FIXED);
  });

  it("post-edit verifyCommand runs the compile oracle after StrReplace", async () => {
    const result = await runAgentEval({
      prompt: "Fix foo.c so it compiles.",
      catalog: SYSTEMS_EVAL_CATALOG,
      workspace: { "src/foo.c": FOO_BUG, Makefile: "all:\n\t$(CC) -c src/foo.c\n" },
      verifyCommand: "make",
      evaluateCommand: async (_args, files) => evalMakeFromWorkspace(files),
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.EditFile,
              args: {
                filepath: "src/foo.c",
                old_string: "int main(void) {",
                new_string: "int bar(void);\n\nint main(void) {",
              },
            },
          ],
        },
        { content: "Edit landed; auto-build is clean." },
      ],
    });

    expect(result.files["src/foo.c"]).toBe(FOO_FIXED);
    expect(result.toolTrace[0]?.name).toBe(BuiltInToolNames.EditFile);
    expect(result.toolTrace[0]?.output).toMatch(/Exit: 0/);
    expect(result.toolTrace[0]?.output).toContain("Build diagnostics");
    expect(result.toolTrace[0]?.output).toMatch(/clean/);
  });

  it("git status uses eval subprocess (HL-03)", async () => {
    const result = await runAgentEval({
      prompt: "What is dirty?",
      catalog: SYSTEMS_EVAL_CATALOG,
      workspace: { "kernel/fork.c": "void copy_process(void) {}\n" },
      ideHooks: {
        subprocess: async (command) => {
          if (command.includes("git status")) {
            return ["## main\n M kernel/fork.c", ""];
          }
          return ["", "unexpected git command"];
        },
      },
      script: [
        {
          toolCalls: [
            { name: BuiltInToolNames.GitStatus, args: {} },
          ],
        },
        { content: "kernel/fork.c is modified." },
      ],
    });

    expect(result.toolTrace[0]?.ok).toBe(true);
    expect(result.toolTrace[0]?.output).toContain("kernel/fork.c");
    expect(result.toolTrace[0]?.output).toContain("## main");
  });

  it("git blame uses eval subprocess (HL-29)", async () => {
    const result = await runAgentEval({
      prompt: "Who touched copy_to_user?",
      catalog: SYSTEMS_EVAL_CATALOG,
      workspace: { "mm/filemap.c": "copy_to_user();\n" },
      ideHooks: {
        subprocess: async (command) => {
          if (command.includes("git blame")) {
            return [
              "abc1234 (Alice 2024-01-01 1) copy_to_user();",
              "",
            ];
          }
          return ["", "unexpected git command"];
        },
      },
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.GitBlame,
              args: { filepath: "mm/filemap.c", start_line: 1, end_line: 1 },
            },
          ],
        },
        { content: "Alice last touched that line." },
      ],
    });
    expect(result.toolTrace[0]?.ok).toBe(true);
    expect(result.toolTrace[0]?.output).toContain("copy_to_user");
    expect(result.toolTrace[0]?.output).toContain("Alice");
  });

  it("runs glob and grep in one turn (parallel readonly batch)", async () => {
    const result = await runAgentEval({
      prompt: "Find copy_to_user and list C files.",
      catalog: SYSTEMS_EVAL_CATALOG,
      workspace: {
        "mm/filemap.c": "copy_to_user();\n",
        "fs/read_write.c": "vfs_read();\n",
      },
      script: [
        {
          toolCalls: [
            { name: BuiltInToolNames.Glob, args: { pattern: "**/*.c" } },
            {
              name: BuiltInToolNames.ExactSearch,
              args: { query: "copy_to_user", path: "mm/" },
            },
          ],
        },
        { content: "Found it in mm/filemap.c." },
      ],
    });
    expect(result.stoppedReason).toBe("completed");
    expect(result.toolTrace).toHaveLength(2);
    expect(result.toolTrace.every((item) => item.ok)).toBe(true);
    expect(result.toolTrace[0]?.output).toMatch(/filemap\.c/);
    expect(result.toolTrace[1]?.output).toContain("copy_to_user");
    expect(result.toolTrace[1]?.output).not.toContain("vfs_read");
  });

  it("await_shell completes a long intercepted job (HL-05)", async () => {
    const jobId = "sh_eval_long";
    const result = await runAgentEval({
      prompt: "Wait for the background make.",
      catalog: SYSTEMS_EVAL_CATALOG,
      workspace: { Makefile: "all:\n" },
      evaluateCommand: async () => [
        {
          name: "Terminal",
          description: "running",
          content: [
            "Command: sleep 180",
            "Status: running",
            `Job: ${jobId}`,
            "Cwd: /tmp/knox-eval-ws",
          ].join("\n"),
        },
      ],
      evaluateAwaitShell: async (args) => {
        expect(String(args.job_id ?? args.jobId)).toBe(jobId);
        return [
          {
            name: "Terminal",
            description: "Terminal command exited 0",
            content: [
              "Command: sleep 180",
              "Status: exited",
              "Exit: 0",
              "Duration: 180000ms",
              "Cwd: /tmp/knox-eval-ws",
            ].join("\n"),
          },
        ];
      },
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.RunTerminalCommand,
              args: { command: "sleep 180", block_until_ms: 0 },
            },
          ],
        },
        {
          toolCalls: [
            {
              name: BuiltInToolNames.AwaitShell,
              args: { job_id: jobId, timeout_ms: 600000 },
            },
          ],
        },
        { content: "The long job finished successfully." },
      ],
    });

    expect(result.stoppedReason).toBe("completed");
    expect(result.toolTrace.map((item) => item.name)).toEqual([
      BuiltInToolNames.RunTerminalCommand,
      BuiltInToolNames.AwaitShell,
    ]);
    expect(result.toolTrace[1]?.output).toMatch(/Exit: 0/);
    expect(result.toolTrace[1]?.output).toMatch(/180000ms/);
    expect(result.toolTrace.map((item) => item.error).join("")).not.toMatch(
      /EXECUTION_TIMEOUT/,
    );
  });

  it("kbuild extract-then-edit: grep copy_process → StrReplace → make", async () => {
    const bug = "asmlinkage void copy_process(void) { missing_helper(); }\n";
    const fixed =
      "void missing_helper(void);\nasmlinkage void copy_process(void) { missing_helper(); }\n";
    const result = await runAgentEval({
      prompt: "Find copy_process and fix the implicit helper so make succeeds.",
      catalog: SYSTEMS_EVAL_CATALOG,
      workspace: {
        Makefile: "obj-y += kernel/fork.o\n",
        "kernel/fork.c": bug,
      },
      evaluateCommand: async (_args, files) => {
        const src = files["kernel/fork.c"] ?? "";
        const implicit =
          /missing_helper\s*\(/.test(src) &&
          !/void missing_helper\s*\(/.test(src);
        if (implicit) {
          return [
            {
              name: "Terminal",
              description: "Terminal command exited 1",
              content: [
                "Command: make",
                "Status: exited",
                "Exit: 1",
                "kernel/fork.c:1:36: error: implicit declaration of function 'missing_helper'",
                "make[1]: *** [kernel/fork.o] Error 1",
              ].join("\n"),
            },
          ];
        }
        return [
          {
            name: "Terminal",
            description: "Terminal command exited 0",
            content: "Command: make\nStatus: exited\nExit: 0\n  CC kernel/fork.o",
          },
        ];
      },
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.ExactSearch,
              args: { query: "copy_process" },
            },
          ],
        },
        {
          toolCalls: [
            {
              name: BuiltInToolNames.EditFile,
              args: {
                filepath: "kernel/fork.c",
                old_string: "asmlinkage void copy_process(void) { missing_helper(); }",
                new_string:
                  "void missing_helper(void);\nasmlinkage void copy_process(void) { missing_helper(); }",
              },
            },
          ],
        },
        {
          toolCalls: [
            {
              name: BuiltInToolNames.RunTerminalCommand,
              args: { command: "make" },
            },
          ],
        },
        { content: "Declared missing_helper; kbuild is clean." },
      ],
    });

    expect(result.stoppedReason).toBe("completed");
    expect(result.toolTrace[0]?.output).toContain("copy_process");
    expect(result.toolTrace[0]?.output).toContain("kernel/fork.c");
    expect(result.files["kernel/fork.c"]).toBe(fixed);
    expect(result.toolTrace[2]?.output).toMatch(/Exit: 0/);
  });

  it("path-scoped grep with fileType=c does not leak other subsystems (HL-22)", async () => {
    const result = await runAgentEval({
      prompt: "Search copy_to_user in mm.",
      catalog: SYSTEMS_EVAL_CATALOG,
      workspace: {
        "mm/filemap.c": "copy_to_user(dst, src, n);\n",
        "fs/read_write.c": "copy_to_user(dst, src, n);\n",
        "mm/filemap.h": "void other(void);\n",
      },
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.ExactSearch,
              args: { query: "copy_to_user", path: "mm", fileType: "c" },
            },
          ],
        },
        { content: "Only mm/filemap.c." },
      ],
    });
    expect(result.toolTrace[0]?.ok).toBe(true);
    expect(result.toolTrace[0]?.output).toContain("mm/filemap.c");
    expect(result.toolTrace[0]?.output).not.toContain("fs/read_write.c");
  });

  it("truncation footer tells the model to pass maxResults/path/fileType (HL-22)", async () => {
    const workspace: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      workspace[`mm/f${i}.c`] = "copy_to_user();\n";
    }
    const result = await runAgentEval({
      prompt: "Search copy_to_user.",
      catalog: SYSTEMS_EVAL_CATALOG,
      workspace,
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.ExactSearch,
              args: { query: "copy_to_user", maxResults: 5 },
            },
          ],
        },
        { content: "Need a narrower path." },
      ],
    });
    expect(result.toolTrace[0]?.output).toMatch(
      /truncated; pass maxResults\/path\/fileType/,
    );
  });

  it("injects a kernel codebase card mentioning make ARCH= and subsystem dirs (HL-28)", async () => {
    const { ide } = createEvalIde({
      Kconfig: "config MMU\n",
      Makefile: "all:\n",
      "arch/x86/Makefile": "obj-y\n",
      "mm/filemap.c": "void filemap(void) {}\n",
      ".config": "CONFIG_X86_64=y\n",
    });
    const card = await loadCodebaseCard(ide);
    expect(card).toContain("Codebase Card");
    expect(card).toContain("make ARCH=x86_64");
    expect(card).toMatch(/arch\//);
    expect(card).toMatch(/mm\//);
  });
});

const PANIC_LOG = [
  "Command: qemu-system-x86_64 -kernel bzImage",
  "Status: exited",
  "Exit: 1",
  "Kernel panic - not syncing: Fatal exception",
  "RIP: 0010:copy_to_user+0x10/0x20",
  "Call Trace:",
  " do_fault+0x1c/0x40 mm/filemap.c:42",
].join("\n");

describe("systems catalog goldens (kconfig / qemu / git / plan)", () => {
  afterEach(() => {
    resetPlansForTests();
  });

  it("kconfig get reads CONFIG_* without dumping .config (HL-34)", async () => {
    const result = await runAgentEval({
      prompt: "What is CONFIG_X86_64?",
      catalog: SYSTEMS_EVAL_CATALOG,
      workspace: {
        Kconfig: "config X86_64\n",
        ".config": "CONFIG_X86_64=y\n# CONFIG_MMU is not set\n",
        "scripts/config": "#!/bin/sh\n",
      },
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.Kconfig,
              args: { op: "get", symbol: "X86_64" },
            },
          ],
        },
        { content: "CONFIG_X86_64=y" },
      ],
    });
    expect(result.toolTrace[0]?.ok).toBe(true);
    expect(result.toolTrace[0]?.output).toContain("CONFIG_X86_64=y");
    expect(result.toolTrace[0]?.output).toContain("scripts/config");
    expect(result.toolTrace[0]?.output).not.toContain("CONFIG_MMU");
  });

  it("maintainers lookup routes mm/filemap.c without dumping THE REST", async () => {
    const result = await runAgentEval({
      prompt: "Who owns mm/filemap.c?",
      catalog: SYSTEMS_EVAL_CATALOG,
      workspace: {
        MAINTAINERS: [
          "MEMORY MANAGEMENT",
          "M:\tAndrew Morton <akpm@linux-foundation.org>",
          "L:\tlinux-mm@kvack.org",
          "S:\tMaintained",
          "F:\tmm/",
          "",
          "THE REST",
          "M:\tNobody",
          "F:\t*",
          "",
        ].join("\n"),
        "mm/filemap.c": "void copy_to_user(void) {}\n",
        "scripts/get_maintainer.pl": "#!/usr/bin/perl\n",
      },
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.Maintainers,
              args: { op: "lookup", path: "mm/filemap.c" },
            },
          ],
        },
        { content: "Andrew Morton maintains mm." },
      ],
    });
    expect(result.toolTrace[0]?.ok).toBe(true);
    expect(result.toolTrace[0]?.output).toContain("MEMORY MANAGEMENT");
    expect(result.toolTrace[0]?.output).toContain("Andrew Morton");
    expect(result.toolTrace[0]?.output).toContain("get_maintainer.pl");
    expect(result.toolTrace[0]?.output).not.toContain("THE REST");
  });

  it("kconfig search stays in Kconfig files (eval fileGlob)", async () => {
    const result = await runAgentEval({
      prompt: "Where is PRINTK defined?",
      catalog: SYSTEMS_EVAL_CATALOG,
      workspace: {
        "lib/Kconfig.debug": "config PRINTK\n\tbool \"Printk\"\n",
        "mm/filemap.c": "printk(\"oops\\n\");\n",
      },
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.Kconfig,
              args: { op: "search", symbol: "CONFIG_PRINTK" },
            },
          ],
        },
        { content: "lib/Kconfig.debug" },
      ],
    });
    expect(result.toolTrace[0]?.output).toContain("lib/Kconfig.debug");
    expect(result.toolTrace[0]?.output).not.toContain("mm/filemap.c");
  });

  it("qemu stub panic is a failed boot oracle with RIP (HL-32)", async () => {
    const result = await runAgentEval({
      prompt: "Boot the kernel.",
      catalog: SYSTEMS_EVAL_CATALOG,
      workspace: { bzImage: "stub\n" },
      evaluateQemu: async () => [
        {
          name: "QEMU",
          description: "panic",
          content: PANIC_LOG,
        },
      ],
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.Qemu,
              args: { action: "start", kernel: "bzImage" },
            },
          ],
        },
        { content: "Guest panicked in copy_to_user." },
      ],
    });
    expect(result.toolTrace[0]?.ok).toBe(true);
    expect(result.toolTrace[0]?.output).toMatch(/Kernel panic/);
    expect(result.toolTrace[0]?.output).toMatch(/Oops: panic/);
    expect(result.toolTrace[0]?.output).toMatch(/copy_to_user/);
    expect(result.toolTrace[0]?.output).not.toMatch(
      /Build diagnostics: clean/,
    );
    expect(diagnosticSignature(result.toolTrace[0]?.output ?? "")).not.toBe(
      "ok",
    );
  });

  it("post-edit verifyCommand treats a kernel panic as not clean", async () => {
    const result = await runAgentEval({
      prompt: "Patch then boot.",
      catalog: SYSTEMS_EVAL_CATALOG,
      workspace: { "mm/filemap.c": "copy_to_user();\n" },
      verifyCommand: "make test",
      evaluateCommand: async () => [
        {
          name: "Terminal",
          description: "Terminal command exited 1",
          content: PANIC_LOG,
        },
      ],
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.EditFile,
              args: {
                filepath: "mm/filemap.c",
                old_string: "copy_to_user();",
                new_string: "copy_to_user(); /* retry */",
              },
            },
          ],
        },
        { content: "Boot still panics." },
      ],
    });
    expect(result.toolTrace[0]?.name).toBe(BuiltInToolNames.EditFile);
    expect(result.toolTrace[0]?.output).toMatch(/Oops: panic/);
    expect(result.toolTrace[0]?.output).toMatch(/RIP: copy_to_user/);
    expect(result.toolTrace[0]?.output).not.toMatch(
      /Build diagnostics: clean/,
    );
  });

  it("git log pickaxe uses eval subprocess -S (HL-29)", async () => {
    const result = await runAgentEval({
      prompt: "Who introduced copy_to_user?",
      catalog: SYSTEMS_EVAL_CATALOG,
      workspace: { "mm/filemap.c": "copy_to_user();\n" },
      ideHooks: {
        subprocess: async (command) => {
          if (command.includes("git log") && command.includes("-S")) {
            return ["abc1234 mm: add copy_to_user", ""];
          }
          return ["", `unexpected git command: ${command}`];
        },
      },
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.GitLog,
              args: { search: "copy_to_user" },
            },
          ],
        },
        { content: "abc1234 added copy_to_user." },
      ],
    });
    expect(result.toolTrace[0]?.ok).toBe(true);
    expect(result.toolTrace[0]?.output).toContain("abc1234");
    expect(result.toolTrace[0]?.output).toContain("copy_to_user");
  });

  it("git bisect start reports remaining revisions (HL-30)", async () => {
    const result = await runAgentEval({
      prompt: "Start a bisect.",
      catalog: SYSTEMS_EVAL_CATALOG,
      workspace: { "mm/filemap.c": "copy_to_user();\n" },
      ideHooks: {
        subprocess: async (command) => {
          if (command.includes("git bisect start")) {
            return [
              "Bisecting: 3 revisions left to test after this (roughly 2 steps)\n[abcd123] mm: break copy_to_user",
              "",
            ];
          }
          if (command.includes("git bisect reset")) {
            return ["", ""];
          }
          return ["", `unexpected git command: ${command}`];
        },
      },
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.GitBisect,
              args: { action: "start", bad: "HEAD", good: "v6.1" },
            },
          ],
        },
        { content: "Bisecting." },
      ],
    });
    expect(result.toolTrace[0]?.ok).toBe(true);
    expect(result.toolTrace[0]?.output).toMatch(/3 revision/);
  });

  it("builtin_plan create/list keeps a kernel checklist (HL-17)", async () => {
    const result = await runAgentEval({
      prompt: "Plan the oops fix.",
      catalog: SYSTEMS_EVAL_CATALOG,
      workspace: { "mm/filemap.c": "copy_to_user();\n" },
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.Plan,
              args: {
                action: "create",
                title: "Boot panic in mm",
                steps: [
                  "Reproduce panic in QEMU",
                  "Parse oops RIP",
                  "Patch copy_to_user",
                ],
              },
            },
          ],
        },
        {
          toolCalls: [
            { name: BuiltInToolNames.Plan, args: { action: "list" } },
          ],
        },
        { content: "Plan is pinned." },
      ],
    });
    expect(result.toolTrace[0]?.output).toContain("Task Execution Plan");
    expect(result.toolTrace[0]?.output).toContain("Boot panic in mm");
    expect(result.toolTrace[1]?.output).toContain("Parse oops RIP");
  });

  it("doom-loops three identical greps without executing the third (HL-11)", async () => {
    const result = await runAgentEval({
      prompt: "Find copy_to_user.",
      catalog: SYSTEMS_EVAL_CATALOG,
      workspace: {
        "mm/filemap.c": "copy_to_user();\n",
      },
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.ExactSearch,
              args: { query: "copy_to_user" },
            },
            {
              name: BuiltInToolNames.ExactSearch,
              args: { query: "copy_to_user" },
            },
            {
              name: BuiltInToolNames.ExactSearch,
              args: { query: "copy_to_user" },
            },
          ],
        },
        { content: "Stuck repeating grep; stop." },
      ],
    });
    expect(result.stoppedReason).toBe("doom_loop");
    expect(result.toolTrace).toHaveLength(3);
    expect(result.toolTrace[0]?.ok).toBe(true);
    expect(result.toolTrace[1]?.ok).toBe(true);
    expect(result.toolTrace[2]?.ok).toBe(false);
    expect(result.toolTrace[2]?.output).toMatch(/doom-loop/i);
  });

  it("doom-loops three identical makes with the same gcc error (HL-11)", async () => {
    const result = await runAgentEval({
      prompt: "Build until it works.",
      catalog: SYSTEMS_EVAL_CATALOG,
      workspace: { "src/foo.c": FOO_BUG, Makefile: "all:\n" },
      evaluateCommand: async () => evalMakeFromWorkspace({ "src/foo.c": FOO_BUG }),
      script: [
        {
          toolCalls: [
            { name: BuiltInToolNames.Build, args: { target: "all" } },
            { name: BuiltInToolNames.Build, args: { target: "all" } },
            { name: BuiltInToolNames.Build, args: { target: "all" } },
          ],
        },
        { content: "Same gcc error three times; stop." },
      ],
    });
    expect(result.stoppedReason).toBe("doom_loop");
    expect(result.toolTrace).toHaveLength(3);
    expect(result.toolTrace.every((item) => item.name === BuiltInToolNames.Build)).toBe(
      true,
    );
    expect(result.toolTrace[0]?.output).toContain("implicit declaration");
  });
});
