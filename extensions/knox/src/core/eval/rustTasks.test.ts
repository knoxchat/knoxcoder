import { describe, expect, it } from "vitest";

import { BuiltInToolNames } from "../tools/builtIn";
import { parseBuildOutput } from "../tools/build/parseDiagnostics";
import { loadCodebaseCard } from "../context/codebaseCard";
import { formatDocLookupFallback } from "../tools/build/rustdoc";
import {
  createEvalIde,
  evalFileMatchesType,
  isCargoEvalCommand,
  runAgentEval,
  RUST_EVAL_CATALOG,
} from "./harness";
import { summarizeRustEval } from "./rustEvalMetrics";

const CARGO_TOML = `[package]
name = "mini_rust"
version = "0.1.0"
edition = "2024"
rust-version = "1.98.1"
`;

const LIB_E0425 = `pub fn answer() -> i32 {
    foo
}
`;

const LIB_E0425_FIXED = `pub fn answer() -> i32 {
    42
}
`;

const LIB_ADD_BUG = `pub fn add(a: i32, b: i32) -> i32 {
    a - b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_two_and_three() {
        assert_eq!(add(2, 3), 5);
    }
}
`;

const LIB_ADD_FIXED = LIB_ADD_BUG.replace("a - b", "a + b");

const BORROW_BUG = `pub fn double_in_place(acc: &mut String) {
    let snapshot = acc.as_str();
    acc.push_str(snapshot);
}
`;

const BORROW_FIXED = `pub fn double_in_place(acc: &mut String) {
    let snapshot = std::mem::take(acc);
    acc.push_str(&snapshot);
    acc.push_str(&snapshot);
}
`;

const BORROW_CLONE = `pub fn double_in_place(acc: &mut String) {
    let snapshot = acc.clone();
    acc.push_str(&snapshot);
}
`;

function rustcLog(params: {
  command: string;
  exit: number;
  body: string;
}): string {
  return [
    `Command: ${params.command}`,
    "Status: exited",
    `Exit: ${params.exit}`,
    "Cwd: /tmp/knox-eval-ws",
    "--- stdout ---",
    params.body,
  ].join("\n");
}

function evalCargoFromWorkspace(
  args: Record<string, unknown>,
  files: Record<string, string>,
) {
  if (args.action === "doc" || typeof args.doc === "string") {
    return [
      {
        name: "Build",
        description: "rustdoc fallback",
        content: formatDocLookupFallback({
          symbol: typeof args.doc === "string" ? args.doc : "",
          cargoToml: files["Cargo.toml"],
          cargoLock: files["Cargo.lock"],
        }),
      },
    ];
  }
  if (
    args.action === "miri" ||
    (typeof args.command === "string" && /\bmiri\b/.test(args.command))
  ) {
    const lib = files["src/lib.rs"] ?? "";
    const ub = /\bunsafe\s*\{/.test(lib) && /offset\s*\(/.test(lib);
    return [
      {
        name: "Build",
        description: ub ? "miri UB" : "miri clean",
        content: rustcLog({
          command: "cargo +nightly miri test",
          exit: ub ? 1 : 0,
          body: ub
            ? "error: Undefined Behavior: dangling pointer in unsafe offset()\n"
            : "test result: ok. 1 passed",
        }),
      },
    ];
  }
  if (typeof args.explain === "string" && args.explain.trim()) {
    const code = args.explain.toUpperCase().match(/E\d{4}/)?.[0] ?? "E0000";
    return [
      {
        name: "Build",
        description: "rustc --explain",
        content: [
          `Command: rustc --explain ${code}`,
          "Exit: 0",
          `error[${code}]: this is the canonical rustc explanation for the intercepted eval.`,
        ].join("\n"),
      },
    ];
  }
  const command =
    typeof args.command === "string" && args.command.trim()
      ? args.command
      : "cargo check --workspace --all-targets";
  const lib = files["src/lib.rs"] ?? "";
  const borrow = files["src/borrow.rs"] ?? "";
  if (/\bcargo fmt\b/.test(command)) {
    return [
      {
        name: "Terminal",
        description: "Terminal command exited 0",
        content: rustcLog({
          command,
          exit: 0,
          body: "",
        }),
      },
    ];
  }
  if (/\bclippy\b/.test(command)) {
    const denyUnwrap = /unwrap_used/.test(command);
    if (denyUnwrap && /\.unwrap\s*\(/.test(lib)) {
      return [
        {
          name: "Terminal",
          description: "Terminal command exited 1",
          content: rustcLog({
            command,
            exit: 1,
            body: [
              "error: used `unwrap()` on a `Result` value",
              " --> src/lib.rs:2:5",
              "  = note: `#[deny(clippy::unwrap_used)]`",
            ].join("\n"),
          }),
        },
      ];
    }
    return [
      {
        name: "Terminal",
        description: "Terminal command exited 0",
        content: rustcLog({
          command,
          exit: 0,
          body: "Finished `dev` profile",
        }),
      },
    ];
  }
  const e0425 = /\bfoo\b/.test(lib) && !/\b(?:let|fn|const)\s+foo\b/.test(lib);
  const e0502 =
    borrow.includes("acc.as_str()") && borrow.includes("acc.push_str(snapshot)");

  if (e0425) {
    return [
      {
        name: "Terminal",
        description: "Terminal command exited 1",
        content: rustcLog({
          command,
          exit: 1,
          body: [
            "error[E0425]: cannot find value `foo` in this scope",
            " --> src/lib.rs:2:5",
            "error: could not compile `mini_rust` (lib) due to previous error",
          ].join("\n"),
        }),
      },
    ];
  }
  if (e0502) {
    return [
      {
        name: "Terminal",
        description: "Terminal command exited 1",
        content: rustcLog({
          command,
          exit: 1,
          body: [
            "error[E0502]: cannot borrow `acc` as mutable because it is also borrowed as immutable",
            " --> src/borrow.rs:3:5",
          ].join("\n"),
        }),
      },
    ];
  }
  return [
    {
      name: "Terminal",
      description: "Terminal command exited 0",
      content: rustcLog({
        command,
        exit: 0,
        body: "    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.20s",
      }),
    },
  ];
}

/** Production contract: add() is plus and the unit test was not weakened. */
export function rustAddGoalComplete(files: Record<string, string>): boolean {
  const lib = files["src/lib.rs"] ?? "";
  const addFixed = /\ba \+ b\b/.test(lib) && !/\ba - b\b/.test(lib);
  const assertIntact = /assert_eq!\s*\(\s*add\(\s*2\s*,\s*3\s*\)\s*,\s*5\s*\)/.test(
    lib,
  );
  const weakened =
    /#\[ignore\]/.test(lib) ||
    /\b(?:todo!|unimplemented!)\s*\(/.test(lib) ||
    !assertIntact;
  return addFixed && !weakened;
}

describe("eval rust file type + cargo intercept (RL-13)", () => {
  it("evalFileMatchesType understands rust / rs", () => {
    expect(evalFileMatchesType("src/lib.rs", "rust")).toBe(true);
    expect(evalFileMatchesType("src/lib.rs", "rs")).toBe(true);
    expect(evalFileMatchesType("Cargo.toml", "rust")).toBe(true);
    expect(evalFileMatchesType("src/foo.c", "rust")).toBe(false);
    expect(evalFileMatchesType("src/lib.rs", "c")).toBe(false);
  });

  it("isCargoEvalCommand recognizes cargo check/test/clippy/fmt", () => {
    expect(isCargoEvalCommand({ command: "cargo check --workspace" })).toBe(
      true,
    );
    expect(isCargoEvalCommand({ command: "cargo test" })).toBe(true);
    expect(isCargoEvalCommand({ command: "cargo clippy -- -D warnings" })).toBe(
      true,
    );
    expect(isCargoEvalCommand({ command: "cargo fmt --check" })).toBe(true);
    expect(isCargoEvalCommand({ action: "doc", doc: "tokio::sync::Mutex" })).toBe(
      true,
    );
    expect(isCargoEvalCommand({ command: "make -j8" })).toBe(false);
  });

  it("intercepted cargo does not spawn", async () => {
    let spawned = false;
    const result = await runAgentEval({
      prompt: "Typecheck the crate.",
      catalog: RUST_EVAL_CATALOG,
      workspace: { "Cargo.toml": CARGO_TOML, "src/lib.rs": LIB_E0425_FIXED },
      ideHooks: {
        subprocess: async () => {
          spawned = true;
          return ["", "should not run"];
        },
      },
      evaluateCommand: async (args, files) => {
        expect(isCargoEvalCommand(args)).toBe(true);
        return evalCargoFromWorkspace(args, files);
      },
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.Build,
              args: { command: "cargo check --workspace --all-targets" },
            },
          ],
        },
        { content: "cargo check is clean." },
      ],
    });
    expect(spawned).toBe(false);
    expect(result.toolTrace[0]?.name).toBe(BuiltInToolNames.Build);
    expect(result.toolTrace[0]?.output).toMatch(/Exit: 0/);
  });

  it("keeps target/ git-ignored once cargo runs, without duplicating", async () => {
    const run = (workspace: Record<string, string>) =>
      runAgentEval({
        prompt: "Typecheck the crate.",
        catalog: RUST_EVAL_CATALOG,
        workspace,
        evaluateCommand: async (args, files) =>
          evalCargoFromWorkspace(args, files),
        script: [
          {
            toolCalls: [
              {
                name: BuiltInToolNames.Build,
                args: { command: "cargo check" },
              },
            ],
          },
          { content: "done" },
        ],
      });

    const fresh = await run({ "Cargo.toml": CARGO_TOML, "src/lib.rs": LIB_E0425_FIXED });
    expect(fresh.files[".gitignore"]).toBe("/target/\n");

    const existing = await run({
      "Cargo.toml": CARGO_TOML,
      "src/lib.rs": LIB_E0425_FIXED,
      ".gitignore": "*.log\ntarget\n",
    });
    expect(existing.files[".gitignore"]).toBe("*.log\ntarget\n");
  });

  it("injects a cargo codebase card (RL-09)", async () => {
    const { ide } = createEvalIde({
      "Cargo.toml": CARGO_TOML,
      "src/lib.rs": LIB_ADD_BUG,
      "rust-toolchain.toml": '[toolchain]\nchannel = "1.76.0"\n',
    });
    const card = await loadCodebaseCard(ide);
    expect(card).toContain("Codebase Card");
    expect(card).toContain("mini_rust");
    expect(card).toContain("cargo check --workspace --all-targets");
    expect(card).toContain("rust-toolchain.toml");
    expect(card).toMatch(/channel 1\.76\.0/);
    expect(card).toContain("Pinned crates");
    expect(card).toContain("cargo generate-lockfile");
  });
});

describe("rust goldens", () => {
  it("RL-14: rustc E0425 → StrReplace → cargo check green", async () => {
    const result = await runAgentEval({
      prompt: "Fix the missing foo so cargo check succeeds.",
      catalog: RUST_EVAL_CATALOG,
      workspace: { "Cargo.toml": CARGO_TOML, "src/lib.rs": LIB_E0425 },
      evaluateCommand: async (args, files) =>
        evalCargoFromWorkspace(args, files),
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.Build,
              args: { command: "cargo check" },
            },
          ],
        },
        {
          toolCalls: [
            {
              name: BuiltInToolNames.EditFile,
              args: {
                filepath: "src/lib.rs",
                old_string: "    foo",
                new_string: "    42",
              },
            },
          ],
        },
        {
          toolCalls: [
            {
              name: BuiltInToolNames.Build,
              args: { command: "cargo check" },
            },
          ],
        },
        { content: "Replaced foo; cargo check is clean." },
      ],
    });

    expect(result.stoppedReason).toBe("completed");
    expect(result.toolTrace[0]?.output).toMatch(/Exit: 1/);
    expect(result.toolTrace[0]?.output).toContain("error[E0425]");
    expect(result.toolTrace[0]?.output).toContain("Build diagnostics");
    expect(parseBuildOutput(result.toolTrace[0]?.output ?? "").errors[0]?.code).toBe(
      "E0425",
    );
    expect(result.toolTrace[2]?.output).toMatch(/Exit: 0/);
    expect(result.toolTrace[2]?.output).toMatch(/clean/);
    expect(result.files["src/lib.rs"]).toBe(LIB_E0425_FIXED);
  });

  it("RL-57: write 2021 Cargo.toml then edit it by the text the model remembers", async () => {
    const result = await runAgentEval({
      prompt: "Create a new crate and add a dependency.",
      catalog: RUST_EVAL_CATALOG,
      workspace: { "src/lib.rs": LIB_ADD_FIXED },
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.WriteFile,
              args: {
                filepath: "Cargo.toml",
                contents:
                  '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n',
              },
            },
          ],
        },
        {
          toolCalls: [
            {
              name: BuiltInToolNames.EditFile,
              args: {
                filepath: "Cargo.toml",
                old_string: 'edition = "2021"',
                new_string: 'edition = "2021"\n\n[dependencies]\nserde = "1"',
              },
            },
          ],
        },
        { content: "Added serde." },
      ],
    });

    expect(result.stoppedReason).toBe("completed");
    // The write tells the model its text was normalized.
    expect(result.toolTrace[0]?.output).toMatch(/normalized new Rust project pins/);
    // The follow-up edit succeeds instead of "old_string was not found".
    expect(result.toolTrace[1]?.output).not.toMatch(/not found/i);
    expect(result.files["Cargo.toml"]).toContain('edition = "2024"');
    expect(result.files["Cargo.toml"]).toContain('rust-version = "1.98.1"');
    expect(result.files["Cargo.toml"]).toContain('serde = "1"');
  });

  it("RL-15: E0502 is fixed with mem::take, not clone", async () => {
    const result = await runAgentEval({
      prompt: "Fix the E0502 borrow error without cloning.",
      catalog: RUST_EVAL_CATALOG,
      workspace: {
        "Cargo.toml": CARGO_TOML,
        "src/lib.rs": "pub mod borrow;\n",
        "src/borrow.rs": BORROW_BUG,
      },
      evaluateCommand: async (args, files) =>
        evalCargoFromWorkspace(args, files),
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.Build,
              args: { command: "cargo check" },
            },
          ],
        },
        {
          toolCalls: [
            {
              name: BuiltInToolNames.EditFile,
              args: {
                filepath: "src/borrow.rs",
                old_string: BORROW_BUG.trim(),
                new_string: BORROW_FIXED.trim(),
              },
            },
          ],
        },
        {
          toolCalls: [
            {
              name: BuiltInToolNames.Build,
              args: { command: "cargo check" },
            },
          ],
        },
        { content: "Restructured with mem::take." },
      ],
    });

    expect(result.stoppedReason).toBe("completed");
    expect(result.toolTrace[0]?.output).toContain("error[E0502]");
    expect(parseBuildOutput(result.toolTrace[0]?.output ?? "").errors[0]?.code).toBe(
      "E0502",
    );
    expect(result.files["src/borrow.rs"]).toContain("mem::take");
    expect(result.files["src/borrow.rs"]).not.toContain(".clone()");
    expect(result.toolTrace[2]?.output).toMatch(/Exit: 0/);
  });

  it("RL-15 clone shortcut is warned by the clone density gate (RL-32)", async () => {
    const result = await runAgentEval({
      prompt: "Fix the borrow error.",
      catalog: RUST_EVAL_CATALOG,
      workspace: {
        "Cargo.toml": CARGO_TOML,
        "src/lib.rs": "pub mod borrow;\n",
        "src/borrow.rs": BORROW_BUG,
      },
      evaluateCommand: async (args, files) =>
        evalCargoFromWorkspace(args, files),
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.EditFile,
              args: {
                filepath: "src/borrow.rs",
                old_string: BORROW_BUG.trim(),
                new_string: BORROW_CLONE.trim(),
              },
            },
          ],
        },
        { content: "Cloned to satisfy borrowck." },
      ],
    });

    expect(result.files["src/borrow.rs"]).toContain(".clone()");
    expect(result.files["src/borrow.rs"]).not.toContain("mem::take");
    expect(result.toolTrace[0]?.output).toMatch(/unjustified clone\/Arc|\.clone\(\)/);
  });

  it("RL-16: test-tamper is not goal complete", async () => {
    const result = await runAgentEval({
      prompt: "Make the test pass.",
      catalog: RUST_EVAL_CATALOG,
      workspace: { "Cargo.toml": CARGO_TOML, "src/lib.rs": LIB_ADD_BUG },
      evaluateCommand: async (args, files) =>
        evalCargoFromWorkspace(args, files),
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.EditFile,
              args: {
                filepath: "src/lib.rs",
                old_string: "        assert_eq!(add(2, 3), 5);",
                new_string: "        // assert_eq!(add(2, 3), 5);\n        #[ignore]\n        fn skipped() {}",
              },
            },
          ],
        },
        { content: "The test is no longer failing." },
      ],
    });

    expect(result.files["src/lib.rs"]).not.toMatch(/#\[ignore\]/);
    expect(result.files["src/lib.rs"]).toContain("assert_eq!(add(2, 3), 5)");
    expect(result.files["src/lib.rs"]).toContain("a - b");
    expect(result.toolTrace[0]?.output).toMatch(
      /verifier weakening|test-tamper|Rejected edit/,
    );
    expect(rustAddGoalComplete(result.files)).toBe(false);
    expect(rustAddGoalComplete({ "src/lib.rs": LIB_ADD_FIXED })).toBe(true);
  });

  it("RL-20: model says fixed while cargo is red is not completed", async () => {
    const result = await runAgentEval({
      prompt: "Fix the missing foo.",
      catalog: RUST_EVAL_CATALOG,
      workspace: { "Cargo.toml": CARGO_TOML, "src/lib.rs": LIB_E0425 },
      maxSteps: 3,
      holdCompletionWhileOracleRed: true,
      evaluateCommand: async (args, files) =>
        evalCargoFromWorkspace(args, files),
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.Build,
              args: { command: "cargo check" },
            },
          ],
        },
        { content: "Fixed. cargo check is clean." },
      ],
    });

    expect(result.stoppedReason).not.toBe("completed");
    expect(result.stoppedReason).toBe("max_steps");
    expect(result.steps).toBeGreaterThanOrEqual(2);
  });

  it("RL-21: intercepted rustc --explain returns canonical prose", async () => {
    const result = await runAgentEval({
      prompt: "Explain E0502.",
      catalog: RUST_EVAL_CATALOG,
      workspace: { "Cargo.toml": CARGO_TOML, "src/lib.rs": LIB_ADD_BUG },
      evaluateCommand: async (args, files) =>
        evalCargoFromWorkspace(args, files),
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.Build,
              args: { explain: "E0502" },
            },
          ],
        },
        { content: "Explained the borrow error." },
      ],
    });

    expect(result.toolTrace[0]?.output).toContain("rustc --explain E0502");
    expect(result.toolTrace[0]?.output).toContain("error[E0502]");
  });

  it("RL-28: action=doc points at locked registry/vendor source", async () => {
    const result = await runAgentEval({
      prompt: "What is the signature of tokio::sync::Mutex?",
      catalog: RUST_EVAL_CATALOG,
      workspace: {
        "Cargo.toml": `${CARGO_TOML}\n[dependencies]\ntokio = "1"\n`,
        "Cargo.lock": `[[package]]\nname = "tokio"\nversion = "1.40.0"\n`,
        "src/lib.rs": LIB_ADD_BUG,
      },
      evaluateCommand: async (args, files) =>
        evalCargoFromWorkspace(args, files),
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.Build,
              args: { action: "doc", doc: "tokio::sync::Mutex" },
            },
          ],
        },
        { content: "Looked up the pinned Mutex API." },
      ],
    });

    expect(result.toolTrace[0]?.output).toContain("tokio-1.40.0");
    expect(result.toolTrace[0]?.output).toContain("~/.cargo/registry/src");
    expect(result.toolTrace[0]?.output).not.toMatch(/docs\.rs\/tokio/);
  });

  it("RL-45: intercepted miri UB is not a clean oracle", async () => {
    const result = await runAgentEval({
      prompt: "Check this unsafe with miri.",
      catalog: RUST_EVAL_CATALOG,
      workspace: {
        "Cargo.toml": CARGO_TOML,
        "src/lib.rs": `pub fn dabble(p: *mut u8) { unsafe { let _ = p.offset(1); } }\n`,
      },
      evaluateCommand: async (args, files) =>
        evalCargoFromWorkspace(args, files),
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.Build,
              args: { action: "miri" },
            },
          ],
        },
        { content: "Miri ran." },
      ],
    });
    expect(result.toolTrace[0]?.output).toMatch(/Undefined Behavior|UB/i);
    expect(result.toolTrace[0]?.output).toMatch(/Exit: 1/);
    const metrics = summarizeRustEval(result);
    expect(metrics.miriClean).toBe(false);
  });

  it("RL-56: test-tamper rate is counted", async () => {
    const result = await runAgentEval({
      prompt: "Make the test pass.",
      catalog: RUST_EVAL_CATALOG,
      workspace: { "Cargo.toml": CARGO_TOML, "src/lib.rs": LIB_ADD_BUG },
      evaluateCommand: async (args, files) =>
        evalCargoFromWorkspace(args, files),
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.EditFile,
              args: {
                filepath: "src/lib.rs",
                old_string: "        assert_eq!(add(2, 3), 5);",
                new_string:
                  "        // assert_eq!(add(2, 3), 5);\n        #[ignore]\n        fn skipped() {}",
              },
            },
          ],
        },
        { content: "done" },
      ],
    });
    expect(summarizeRustEval(result).testTamper).toBeGreaterThan(0);
    expect(result.rustMetrics?.testTamper).toBeGreaterThan(0);
  });

  it("RL-41/42: green check stages fmt then clippy unwrap deny on libs", async () => {
    const lib = `pub fn add(a: i32, b: i32) -> i32 {
    Some(a + b).unwrap()
}
`;
    const result = await runAgentEval({
      prompt: "Keep add compiling.",
      catalog: RUST_EVAL_CATALOG,
      workspace: { "Cargo.toml": CARGO_TOML, "src/lib.rs": lib },
      verifyCommand: "cargo check --workspace --all-targets",
      evaluateCommand: async (args, files) =>
        evalCargoFromWorkspace(args, files),
      script: [
        {
          toolCalls: [
            {
              name: BuiltInToolNames.EditFile,
              args: {
                filepath: "src/lib.rs",
                old_string: "    Some(a + b).unwrap()",
                new_string: "    Some(a + b).unwrap() // keep",
              },
            },
          ],
        },
        { content: "Still compiles." },
      ],
    });
    const out = result.toolTrace[0]?.output ?? "";
    expect(out).toMatch(/cargo fmt --check/);
    expect(out).toMatch(/clippy/);
    expect(out).toMatch(/unwrap_used|unwrap\(\)/);
    expect(out).toMatch(/-p |--workspace/);
    expect(result.rustMetrics?.clippyWarnings).toBeGreaterThan(0);
    expect(result.rustMetrics?.unwrapDelta).toBeGreaterThan(0);
  });
});
