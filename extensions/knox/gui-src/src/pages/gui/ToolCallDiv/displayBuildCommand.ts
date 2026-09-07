/**
 * Prompt-line preview for `builtin_build`. The real command is in the
 * streamed terminal body; this is only the xterm `❯` line from tool args.
 */
export function displayBuildCommand(
  args: Record<string, unknown> | undefined,
): string {
  if (!args) {
    return "project build";
  }

  const explain = typeof args.explain === "string" ? args.explain.trim() : "";
  if (explain) {
    const code = explain.toUpperCase().match(/E\d{4}/);
    return code ? `rustc --explain ${code[0]}` : `rustc --explain ${explain}`;
  }

  const doc =
    (typeof args.doc === "string" && args.doc.trim()) ||
    (typeof args.symbol === "string" && args.symbol.trim()) ||
    "";
  const action =
    typeof args.action === "string" ? args.action.trim().toLowerCase() : "";
  if (action === "doc" || doc) {
    return doc ? `rustdoc ${doc}` : "rustdoc lookup";
  }

  if (typeof args.command === "string" && args.command.trim()) {
    return args.command.trim();
  }

  const extra =
    (typeof args.extraArgs === "string" && args.extraArgs.trim()) ||
    (typeof args.extra_args === "string" && args.extra_args.trim()) ||
    "";
  const jobsRaw = args.jobs;
  const jobs =
    typeof jobsRaw === "number" && Number.isFinite(jobsRaw) && jobsRaw > 0
      ? `-j${Math.min(Math.floor(jobsRaw), 256)}`
      : "";
  const target = typeof args.target === "string" ? args.target.trim() : "";
  const pkg =
    target && /^[\w.-]+$/.test(target) && !target.includes("/")
      ? `-p ${target}`
      : target;

  const cargoVerb: Record<string, string> = {
    check: "check",
    build: "build",
    bench: "bench",
    clippy: "clippy",
    test: "test",
    fix: "fix --allow-dirty",
    expand: "expand",
    miri: "+nightly miri test",
    deny: "deny check",
    audit: "audit",
    tree: "tree",
    fmt: "fmt --check",
  };
  const verb = cargoVerb[action];
  if (verb) {
    return ["cargo", verb, jobs, pkg, extra].filter(Boolean).join(" ");
  }

  if (!action && !jobs && !pkg && !extra) {
    return "project build";
  }

  return ["build", jobs, pkg, extra].filter(Boolean).join(" ");
}
