import { describe, expect, it } from "vitest";

import { formatBuildDiagnostics, parseBuildOutput } from "./parseDiagnostics";
import {
  BORROWCK_REMEDY_MARKER,
  ORPHAN_REMEDY_MARKER,
  formatRustcRemedyReminder,
} from "./rustcRemedies";

describe("formatRustcRemedyReminder", () => {
  it("fires the ownership menu on E0502", () => {
    const parsed = parseBuildOutput(
      [
        "error[E0502]: cannot borrow `x` as mutable because it is also borrowed as immutable",
        " --> src/borrow.rs:12:9",
      ].join("\n"),
    );
    const reminder = formatRustcRemedyReminder(parsed.diagnostics);
    expect(reminder).toContain(BORROWCK_REMEDY_MARKER);
    expect(reminder).toMatch(/mem::take/);
    expect(reminder).not.toMatch(/sprinkle/i);
    expect(formatBuildDiagnostics(parsed)).toContain(BORROWCK_REMEDY_MARKER);
  });

  it("fires the orphan-rule design signal on E0117", () => {
    const reminder = formatRustcRemedyReminder([
      {
        kind: "error",
        code: "E0117",
        message: "only traits defined in the current crate can be implemented",
        raw: "error[E0117]",
      },
    ]);
    expect(reminder).toContain(ORPHAN_REMEDY_MARKER);
    expect(reminder).toMatch(/newtype/);
  });

  it("fires the ownership menu on lifetime / split-borrow codes", () => {
    expect(
      formatRustcRemedyReminder([
        {
          kind: "error",
          code: "E0106",
          message: "missing lifetime specifier",
          raw: "error[E0106]",
        },
      ]),
    ).toContain(BORROWCK_REMEDY_MARKER);
    expect(
      formatRustcRemedyReminder([
        {
          kind: "error",
          code: "E0501",
          message: "cannot borrow as mutable because previously borrowed",
          raw: "error[E0501]",
        },
      ]),
    ).toContain(BORROWCK_REMEDY_MARKER);
  });

  it("stays quiet on clean or unrelated rustc codes", () => {
    expect(formatRustcRemedyReminder([])).toBe("");
    expect(
      formatRustcRemedyReminder([
        {
          kind: "error",
          code: "E0425",
          message: "cannot find value `foo`",
          raw: "error[E0425]",
        },
      ]),
    ).toBe("");
  });
});
