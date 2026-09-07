/**
 * Injected rustc failure-mode reminders (RL-31 / RL-38).
 *
 * Named remedy menus — not “sprinkle clone” and not tweaking orphan impls.
 */

import type { BuildDiagnostic } from "./parseDiagnostics";

export const BORROWCK_REMEDY_MARKER = "Ownership remedy";
export const ORPHAN_REMEDY_MARKER = "Trait coherence";

const BORROWCK_CODES = new Set([
  "E0106",
  "E0373",
  "E0382",
  "E0495",
  "E0499",
  "E0501",
  "E0502",
  "E0503",
  "E0504",
  "E0505",
  "E0506",
  "E0507",
  "E0508",
  "E0509",
  "E0515",
  "E0594",
  "E0596",
  "E0597",
  "E0623",
]);

const ORPHAN_CODES = new Set(["E0117", "E0119"]);

function diagnosticCodes(diagnostics: BuildDiagnostic[]): string[] {
  return diagnostics
    .map((item) => item.code?.toUpperCase())
    .filter((code): code is string => Boolean(code));
}

export function isBorrowckCode(code: string | undefined): boolean {
  if (!code) {
    return false;
  }
  return BORROWCK_CODES.has(code.toUpperCase());
}

export function formatRustcRemedyReminder(
  diagnostics: BuildDiagnostic[],
): string {
  const codes = diagnosticCodes(diagnostics);
  const parts: string[] = [];
  if (codes.some((code) => isBorrowckCode(code))) {
    parts.push(
      [
        `## ${BORROWCK_REMEDY_MARKER}`,
        "Restate the ownership graph in prose before the next edit.",
        "Remedy menu only: split borrows, index-based access, `std::mem::take`, pass `&mut` down, restructure, arena/`slotmap`. Not `.clone()` / `Arc<Mutex<_>>` / `RefCell` without `// share:` or `// owned:`.",
        "After 2 failed compile attempts, stop mutating types.",
      ].join("\n"),
    );
  }
  if (codes.some((code) => ORPHAN_CODES.has(code))) {
    parts.push(
      [
        `## ${ORPHAN_REMEDY_MARKER}`,
        "E0117 / E0119 is a design signal. Use a newtype wrapper; do not keep tweaking impl headers.",
      ].join("\n"),
    );
  }
  return parts.join("\n\n");
}
