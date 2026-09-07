/**
 * Short rust-profile system inject (RL-19). Not the Book — non-negotiables only.
 */

export const RUST_POLICY_MARKER = "Rust Engineering Policy";

let rustPolicyEnabled = false;
let rustUserTask = "";

const TEST_EDIT_OK_RE =
  /\b(edit|change|update|rewrite|modify|delete|remove)\b[\s\S]{0,80}\b(tests?|assert(?:_eq|_ne)?|test files?)\b|\b(tests?|assert(?:_eq|_ne)?|test files?)\b[\s\S]{0,80}\b(edit|change|update|rewrite|modify|delete|remove)\b|\ballow[- ]test[- ]edits?\b/i;

export function rustPolicyShouldEnable(input?: {
  card?: string;
  verifyCommand?: string;
  workspaceKind?: string | null;
  profile?: string;
}): boolean {
  if (!input) {
    return false;
  }
  if (input.profile === "rust" || input.workspaceKind === "cargo") {
    return true;
  }
  if (input.verifyCommand && /^\s*cargo\b/i.test(input.verifyCommand)) {
    return true;
  }
  const card = input.card ?? "";
  return (
    /Cargo crate \/ workspace/.test(card) ||
    /cargo check --workspace/.test(card) ||
    /Pinned crates/.test(card)
  );
}

export function setRustPolicyEnabled(enabled: boolean): void {
  rustPolicyEnabled = enabled;
}

export function isRustPolicyEnabled(): boolean {
  return rustPolicyEnabled;
}

export function setRustUserTask(task: string): void {
  rustUserTask = task;
}

export function rustUserAllowsTestEdits(): boolean {
  return TEST_EDIT_OK_RE.test(rustUserTask);
}

export function resetRustPolicyForTests(): void {
  rustPolicyEnabled = false;
  rustUserTask = "";
}

export function buildRustPolicy(): string {
  return [
    `## ${RUST_POLICY_MARKER}`,
    "MSRV / edition from rust-toolchain.toml or package.edition — never newer syntax. Pinned crate versions come from Cargo.lock.",
    "`#![forbid(unsafe_code)]` unless the task authorizes unsafe. Every `unsafe` needs `// SAFETY:`.",
    "No new dependency without justification.",
    "Zero clippy warnings at `-D warnings`. No `#[allow]` without an inline reason.",
    "Process: read → rust-analyzer hover → ownership in prose on borrow errors → failing test first → smallest change → cargo check / clippy / test.",
    "If a fix needs >2 compile attempts, stop mutating types and reconsider design.",
    "Forbidden: test edits to pass, todo!/unimplemented! as done, perf claims without criterion.",
    "Roles (do not auto-spawn): rust-borrowck after 1 failed borrowck attempt; rust-review before claiming done; rust-architect for new public APIs.",
  ].join("\n");
}

export function formatRustPolicyInject(): string {
  return rustPolicyEnabled ? buildRustPolicy() : "";
}
