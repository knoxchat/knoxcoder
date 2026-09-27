import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const buildTool: Tool = {
  type: "function",
  displayTitle: t("build"),
  wouldLikeTo: t("wouldLikeToBuild"),
  isCurrently: t("isBuilding"),
  hasAlready: t("hasBuilt"),
  readonly: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.Build,
    description: `Run an incremental project build (cargo check / make / ninja / verifyCommand) and return parsed compiler errors — not a raw CC or first-compile log.

Prefer this over shell \`cargo\` / \`make\` when checking whether edits compile. Never uses \`cargo clean\`, \`cargo publish\`, \`make clean\`, \`mrproper\`, or \`distclean\`. Default command: root Cargo.toml → cargo check --workspace --all-targets (pure crates; kernel/QEMU still use make/ninja), else Makefile → make, else build.ninja → ninja, else the configured verifyCommand.`,
    parameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description:
            "Make/ninja target (e.g. net/ipv4/ or src/foo.o), or cargo package name (-p). Omit for the default all/first target.",
        },
        jobs: {
          type: "number",
          description: "Parallel jobs for -jN (make/ninja/cargo). Omit to use the tool default.",
        },
        cwd: {
          type: "string",
          description: "Build directory (workspace-relative or absolute).",
        },
        extraArgs: {
          type: "string",
          description:
            "Extra make/ninja/cargo arguments (e.g. --features foo). Do not pass clean/mrproper/publish. Do not default --all-features on huge workspaces.",
        },
        env: {
          type: "object",
          description: "Optional ARCH / CROSS_COMPILE for kbuild.",
          properties: {
            ARCH: { type: "string" },
            CROSS_COMPILE: { type: "string" },
          },
        },
        command: {
          type: "string",
          description:
            "Override the full command (e.g. cargo check -p foo, make -j8 net/ipv4/). Ignored if it contains clean/mrproper/publish.",
        },
        explain: {
          type: "string",
          description:
            "Rustc error code to explain (e.g. E0502). Runs `rustc --explain` instead of a compile. Call on the first occurrence of a code in the turn.",
        },
        action: {
          type: "string",
          enum: [
            "doc",
            "clippy",
            "fmt",
            "test",
            "fix",
            "expand",
            "miri",
            "deny",
            "audit",
            "tree",
          ],
          description:
            "Cargo helper. `doc` = rustdoc JSON / registry source (no docs.rs). `clippy` / `fmt` / `test` are outer gates (check stays the inner loop). `fix` is cargo fix --allow-dirty (never --broken-code). `expand` / `miri` / `deny` / `audit` require optional binaries; missing → install hint. `tree` is cargo tree.",
        },
        doc: {
          type: "string",
          description:
            "Symbol to look up when action=doc (e.g. tokio::sync::Mutex). Prefer rust-analyzer hover when it is live.",
        },
      },
    },
  },
};
