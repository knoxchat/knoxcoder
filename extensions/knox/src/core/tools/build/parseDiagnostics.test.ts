import { describe, expect, it } from "vitest";

import {
  diagnosticSignature,
  formatBuildDiagnostics,
  parseBuildOutput,
} from "./parseDiagnostics";

const PANIC = [
  "Kernel panic - not syncing: Fatal exception",
  "RIP: 0010:copy_to_user+0x10/0x20",
  "Call Trace:",
  " do_fault+0x1c/0x40 mm/filemap.c:42",
].join("\n");

describe("parseBuildOutput runtime oracles", () => {
  it("treats gcc errors as before", () => {
    const parsed = parseBuildOutput(
      "src/foo.c:2:3: error: implicit declaration of function 'bar'\n",
    );
    expect(parsed.errors[0]?.file).toBe("src/foo.c");
    expect(diagnosticSignature(parsed.errors[0]?.raw ?? "")).not.toBe("ok");
  });

  it("does not call a panic-free log clean for kselftest FAIL", () => {
    const log = "selftests: mm: map_populate [FAIL]";
    const parsed = parseBuildOutput(log);
    expect(parsed.errors[0]?.code).toBe("kselftest");
    expect(diagnosticSignature(log)).not.toBe("ok");
    expect(formatBuildDiagnostics(log)).not.toMatch(/clean/);
  });

  it("parses TAP not ok lines", () => {
    const log = "not ok 1 selftests: mm: madv_populate # exit=1";
    expect(parseBuildOutput(log).errors[0]?.message).toContain("madv_populate");
  });

  it("treats a kernel panic as an oracle failure with RIP", () => {
    const parsed = parseBuildOutput(PANIC);
    expect(parsed.errors.some((item) => item.code === "panic")).toBe(true);
    expect(diagnosticSignature(PANIC)).toMatch(/copy_to_user/);
    expect(diagnosticSignature(PANIC)).not.toBe("ok");
    expect(formatBuildDiagnostics(PANIC)).toMatch(/Oops: panic/);
    expect(formatBuildDiagnostics(PANIC)).toMatch(/RIP: copy_to_user/);
  });

  it("fingerprints a new RIP as a different boot failure", () => {
    const other = PANIC.replace("copy_to_user", "copy_from_user");
    expect(diagnosticSignature(PANIC)).not.toBe(diagnosticSignature(other));
  });

  it("still reports clean for a successful make", () => {
    const log = "  CC src/foo.o\n  LD vmlinux\n";
    expect(parseBuildOutput(log).errors).toHaveLength(0);
    expect(diagnosticSignature(log)).toBe("ok");
    expect(formatBuildDiagnostics(log)).toMatch(/clean/);
  });
});

const RUSTC_E0425 = [
  "error[E0425]: cannot find value `foo` in this scope",
  " --> src/lib.rs:3:5",
  "help: a local variable with a similar name exists: `bar`",
].join("\n");

const RUSTC_E0502 = [
  "error[E0502]: cannot borrow `x` as mutable because it is also borrowed as immutable",
  " --> src/borrow.rs:12:9",
].join("\n");

const CLIPPY_UNWRAP = [
  "warning: used `unwrap()` on a `Result` value",
  " --> src/lib.rs:5:13",
  "  = note: `#[warn(clippy::unwrap_used)]` on by default",
].join("\n");

const CARGO_JSON = JSON.stringify({
  reason: "compiler-message",
  message: {
    rendered:
      "error[E0425]: cannot find value `foo` in this scope\n --> src/lib.rs:3:5\n",
    code: { code: "E0425", explanation: null },
    level: "error",
    message: "cannot find value `foo` in this scope",
    spans: [
      {
        file_name: "src/lib.rs",
        line_start: 3,
        column_start: 5,
        is_primary: true,
        suggested_replacement: null,
      },
    ],
    children: [
      {
        level: "help",
        message: "a local variable with a similar name exists",
        spans: [
          {
            file_name: "src/lib.rs",
            line_start: 3,
            column_start: 5,
            suggested_replacement: "bar",
            is_primary: true,
          },
        ],
      },
    ],
  },
});

describe("parseBuildOutput rustc / clippy / cargo", () => {
  it("parses error[E0425] with file:line and help", () => {
    const parsed = parseBuildOutput(RUSTC_E0425);
    expect(parsed.errors[0]?.code).toBe("E0425");
    expect(parsed.errors[0]?.file).toBe("src/lib.rs");
    expect(parsed.errors[0]?.line).toBe(3);
    expect(parsed.notes[0]?.message).toMatch(/similar name/);
  });

  it("fingerprints a new rustc code as a different doom-loop signature", () => {
    expect(diagnosticSignature(RUSTC_E0425)).toMatch(/E0425/);
    expect(diagnosticSignature(RUSTC_E0502)).toMatch(/E0502/);
    expect(diagnosticSignature(RUSTC_E0425)).not.toBe(
      diagnosticSignature(RUSTC_E0502),
    );
  });

  it("parses clippy lint ids into BuildDiagnostic.code", () => {
    const parsed = parseBuildOutput(CLIPPY_UNWRAP);
    expect(parsed.warnings[0]?.code).toBe("clippy::unwrap_used");
    expect(parsed.warnings[0]?.file).toBe("src/lib.rs");
  });

  it("treats clippy -D unwrap_used / await_holding_lock as oracle errors", () => {
    const unwrapDeny = [
      "error: used `unwrap()` on a `Result` value",
      " --> src/lib.rs:5:13",
      "  = note: `#[deny(clippy::unwrap_used)]`",
    ].join("\n");
    const parsedUnwrap = parseBuildOutput(unwrapDeny);
    expect(parsedUnwrap.errors[0]?.code).toBe("clippy::unwrap_used");
    expect(formatBuildDiagnostics(unwrapDeny)).not.toMatch(/clean/);

    const awaitLock = [
      "error: this MutexGuard is held across an await point",
      " --> src/lib.rs:10:5",
      "  = note: `#[deny(clippy::await_holding_lock)]`",
    ].join("\n");
    const parsedAwait = parseBuildOutput(awaitLock);
    expect(parsedAwait.errors[0]?.code).toBe("clippy::await_holding_lock");
    expect(diagnosticSignature(awaitLock)).not.toBe("ok");
  });

  it("parses cargo test and nextest FAIL lines", () => {
    expect(
      parseBuildOutput("test foo::bar ... FAILED").errors[0]?.message,
    ).toContain("foo::bar");
    const nextest = parseBuildOutput(
      "        FAIL [   0.010s] mini_rust tests::add",
    );
    expect(nextest.errors[0]?.code).toBe("nextest");
    expect(nextest.errors[0]?.message).toContain("tests::add");
  });

  it("parses error: could not compile", () => {
    const log = "error: could not compile `mini_rust` (lib) due to previous error";
    expect(parseBuildOutput(log).errors[0]?.message).toMatch(/could not compile/);
    expect(diagnosticSignature(log)).not.toBe("ok");
  });

  it("extracts cargo JSON diagnostics and suggested_replacement", () => {
    const parsed = parseBuildOutput(CARGO_JSON);
    expect(parsed.errors[0]?.code).toBe("E0425");
    expect(parsed.errors[0]?.file).toBe("src/lib.rs");
    expect(parsed.errors[0]?.suggestedReplacement).toBe("bar");
    expect(formatBuildDiagnostics(CARGO_JSON)).toMatch(/Suggested fix/);
    expect(formatBuildDiagnostics(CARGO_JSON)).toContain("bar");
  });
});
