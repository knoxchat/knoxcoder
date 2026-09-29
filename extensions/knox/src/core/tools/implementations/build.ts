import type { ContextItem } from "../..";
import { ToolImpl } from ".";
import { SHELL_WAIT_HARD_CAP_MS } from "../shellJobs";
import { runTerminalCommandImpl } from "./runTerminalCommand";
import {
  attachBuildDiagnostics,
  composeBuildCommand,
  composeCargoActionCommand,
  detectBuildCommand,
  destructiveBuildReason,
  isCargoCommand,
} from "../build/verifyCommand";
import {
  binaryOnPath,
  findMissingCrossCompiler,
} from "../build/crossCompile";
import {
  inferArchFromConfig,
  parseCargoManifest,
} from "../../context/codebaseCard";
import { joinPathsToUri } from "../../util/uri";
import { inferResolvedUriFromRelativePath } from "../../util/ideUtils";
import { parseBuildOutput } from "../build/parseDiagnostics";
import {
  composeTestCommand,
  detectTestRunners,
  formatTestResults,
  pickTestRunner,
  testsRed,
  type DetectedTestRunner,
  type WorkspaceFacts,
} from "../build/testRunner";
import {
  formatDocLookupFallback,
  lookupRustdocSymbol,
} from "../build/rustdoc";
import {
  composeFallbackGateCommand,
  composeGateScriptCommand,
  formatGateVerdict,
  gateRefusedReason,
  looksLikeCargoGateScript,
  readBundledGateScript,
  resolveGateMode,
  RUST_GATE_MARKER,
  RUST_GATE_SCRIPT,
} from "../build/rustGate";

export function optionalCargoPluginHint(
  action: string,
): { bin: string; install: string } | undefined {
  const plugins: Record<string, { bin: string; install: string }> = {
    expand: {
      bin: "cargo-expand",
      install:
        "install cargo-expand (cargo install cargo-expand). Do not invent macro expansions.",
    },
    miri: {
      bin: "cargo-miri",
      install:
        "rustup +nightly component add miri. Do not claim unsafe code is sound.",
    },
    deny: {
      bin: "cargo-deny",
      install: "install cargo-deny if you need a supply-chain check (optional).",
    },
    audit: {
      bin: "cargo-audit",
      install: "install cargo-audit if you need a RustSec audit (optional, network).",
    },
  };
  return plugins[action];
}

async function missingOptionalCargoPlugin(
  action: string,
  which: (binary: string) => Promise<boolean>,
): Promise<{ name: string; description: string; content: string } | undefined> {
  const plugin = optionalCargoPluginHint(action);
  if (!plugin) {
    return undefined;
  }
  if (await which(plugin.bin)) {
    return undefined;
  }
  return {
    name: "Build",
    description: `missing ${plugin.bin}`,
    content: `${plugin.bin} is not installed. ${plugin.install}`,
  };
}

function rustcExplainCommand(raw: string): string | undefined {
  const match = raw.toUpperCase().match(/E\d{4}/);
  return match ? `rustc --explain ${match[0]}` : undefined;
}

function cargoDocSymbol(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) {
    return undefined;
  }
  const action = typeof args.action === "string" ? args.action.trim().toLowerCase() : "";
  const doc =
    typeof args.doc === "string"
      ? args.doc.trim()
      : typeof args.symbol === "string"
        ? args.symbol.trim()
        : "";
  if (action && action !== "doc") {
    return undefined;
  }
  if (action === "doc" || doc) {
    return doc;
  }
  return undefined;
}

async function rustdocLookupItems(
  extras: Parameters<ToolImpl>[1],
  symbol: string,
): Promise<{ name: string; description: string; content: string }[]> {
  const dirs = await extras.ide.getWorkspaceDirs();
  const root = dirs[0] ?? "";
  let cargoToml = "";
  let cargoLock = "";
  let rustdocJson = "";
  const readIfExists = async (uri: string): Promise<string> => {
    try {
      if (uri && (await extras.ide.fileExists(uri))) {
        return await extras.ide.readFile(uri);
      }
    } catch {
      // optional
    }
    return "";
  };
  if (root) {
    cargoToml = await readIfExists(joinPathsToUri(root, "Cargo.toml"));
    cargoLock = await readIfExists(joinPathsToUri(root, "Cargo.lock"));
    const crate = parseCargoManifest(cargoToml).name?.replace(/-/g, "_");
    if (crate) {
      rustdocJson = await readIfExists(
        joinPathsToUri(root, "target", "doc", `${crate}.json`),
      );
    }
  }
  const hit = rustdocJson ? lookupRustdocSymbol(rustdocJson, symbol) : undefined;
  return [
    {
      name: "Build",
      description: hit ? "rustdoc" : "rustdoc fallback",
      content:
        hit ??
        formatDocLookupFallback({
          symbol,
          cargoToml,
          cargoLock,
        }),
    },
  ];
}

function relabelTerminalAsBuild(items: ContextItem[]): ContextItem[] {
  return items.map((item) =>
    item.name === "Terminal" ? { ...item, name: "Build" } : item,
  );
}

function extrasWithBuildStream(
  extras: Parameters<ToolImpl>[1],
): Parameters<ToolImpl>[1] {
  if (!extras.onPartialOutput) {
    return extras;
  }
  return {
    ...extras,
    onPartialOutput: (items) => {
      extras.onPartialOutput?.(relabelTerminalAsBuild(items));
    },
  };
}

/** Top-level files that decide which test runner a directory uses. */
const TEST_PROBE_NAMES = [
  "Cargo.toml",
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "requirements.txt",
  "tox.ini",
  "pytest.ini",
  "conftest.py",
  "uv.lock",
  "poetry.lock",
  "tests",
  "test",
  "go.mod",
];

async function testWorkspaceFacts(
  ide: Parameters<ToolImpl>[1]["ide"],
  dirUri: string,
): Promise<WorkspaceFacts> {
  let entries: string[] = [];
  if (typeof ide.listDir === "function") {
    try {
      entries = (await ide.listDir(dirUri)).map(([name]) => name);
    } catch {
      entries = [];
    }
  }
  if (!entries.length) {
    for (const name of TEST_PROBE_NAMES) {
      try {
        if (await ide.fileExists(joinPathsToUri(dirUri, name))) {
          entries.push(name);
        }
      } catch {
        // probe is best-effort
      }
    }
  }
  return {
    entries,
    readText: async (name) => {
      try {
        const uri = joinPathsToUri(dirUri, name);
        return (await ide.fileExists(uri)) ? await ide.readFile(uri) : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

function testArg(args: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

/** `action: "test"` — detect the project's runner, run once, parse failures. */
async function runTestAction(
  args: Record<string, unknown>,
  extras: Parameters<ToolImpl>[1],
  streamed: Parameters<ToolImpl>[1],
): Promise<ContextItem[]> {
  const target = testArg(args, "target");
  const filter = testArg(args, "filter", "test_name", "testName");
  const extraArgs = testArg(args, "extraArgs", "extra_args");
  const cwdArg = testArg(args, "cwd", "working_directory");
  const explicit = testArg(args, "command");

  const refused = destructiveBuildReason(
    [explicit, target, filter, extraArgs].filter(Boolean).join(" "),
  );
  if (refused) {
    return [{ name: "Build", description: "refused", content: refused }];
  }

  let runner: DetectedTestRunner | undefined;
  let notes: string[] = [];
  let command = explicit;
  const others: string[] = [];

  if (!explicit) {
    const dirs = await extras.ide.getWorkspaceDirs();
    const root = dirs[0] ?? "";
    let dirUri = root;
    if (cwdArg) {
      try {
        dirUri = await inferResolvedUriFromRelativePath(cwdArg, extras.ide);
      } catch {
        dirUri = root;
      }
    }
    const detected = dirUri
      ? await detectTestRunners(await testWorkspaceFacts(extras.ide, dirUri))
      : [];
    runner = pickTestRunner(detected, target);
    if (!runner) {
      return [
        {
          name: "Build",
          description: "no test runner",
          content:
            "No test runner detected (looked for Cargo.toml, package.json with a test script or vitest/jest/mocha, pytest/unittest, go.mod). " +
            "Pass `command` (e.g. `make test`) or `cwd` for a sub-project. Do not claim tests passed.",
        },
      ];
    }
    for (const other of detected) {
      if (other !== runner) {
        others.push(other.label);
      }
    }
    const composed = composeTestCommand(runner, {
      target,
      filter,
      extraArgs,
      jobs: typeof args.jobs === "number" ? args.jobs : undefined,
      docTests: args.docTests === true,
    });
    command = composed.command;
    notes = composed.notes;
  }

  // Skip the PATH probe when the IDE cannot run subprocesses (tests, remote).
  const canProbe = typeof extras.ide.subprocess === "function";
  const which = (binary: string) =>
    binaryOnPath(extras.ide.subprocess.bind(extras.ide), binary);
  if (runner && canProbe && !(await which(runner.binary))) {
    return [
      {
        name: "Build",
        description: `missing ${runner.binary}`,
        content: `${runner.binary} is not on PATH, so ${runner.label} did not run. Install it or pass a different \`command\`. Do not claim tests passed.`,
      },
    ];
  }

  const items = relabelTerminalAsBuild(
    await runTerminalCommandImpl(
      {
        command,
        working_directory: cwdArg || undefined,
        block_until_ms: SHELL_WAIT_HARD_CAP_MS,
      },
      streamed,
    ),
  );
  const log = items.map((item) => item.content ?? "").join("\n");
  const withDiagnostics =
    runner?.kind === "cargo" || parseBuildOutput(log).errors.length > 0
      ? attachBuildDiagnostics(items)
      : items;

  if (/Status:\s*running/i.test(log)) {
    return [
      ...withDiagnostics,
      {
        name: "Test results",
        description: "still running",
        content:
          "Tests are still running in the background. Use the await-shell tool to wait; do not report results yet.",
      },
    ];
  }
  const body = [
    formatTestResults(log, runner),
    ...notes,
    others.length
      ? `Other test runners detected: ${others.join(", ")}. Use \`target\`, \`cwd\` or \`command\` to run those.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return [
    ...withDiagnostics,
    {
      name: "Test results",
      description: testsRed(log) ? "failing" : "passing",
      content: body,
    },
  ];
}

/** Resolve the directory an action runs in (`cwd` arg or the first workspace dir). */
async function actionDirUri(
  args: Record<string, unknown>,
  extras: Parameters<ToolImpl>[1],
): Promise<string> {
  const dirs = await extras.ide.getWorkspaceDirs();
  const root = dirs[0] ?? "";
  const cwdArg = testArg(args, "cwd", "working_directory");
  if (!cwdArg) {
    return root;
  }
  try {
    return await inferResolvedUriFromRelativePath(cwdArg, extras.ide);
  } catch {
    return root;
  }
}

function missingCargoItem(): ContextItem {
  return {
    name: "Build",
    description: "missing cargo",
    content: [
      "cargo not found on PATH.",
      "Install rustup from https://rustup.rs/ (provides cargo and rustc).",
      "builtin_build did not start cargo (avoiding a missing-toolchain log).",
    ].join("\n"),
  };
}

/**
 * `action: "gate"` — run every cargo oracle once (fmt → check → clippy → test).
 * Uses the project's `scripts/pre-commit.sh` when present, else an inline chain.
 */
async function runGateAction(
  args: Record<string, unknown>,
  extras: Parameters<ToolImpl>[1],
  streamed: Parameters<ToolImpl>[1],
): Promise<ContextItem[]> {
  const cwdArg = testArg(args, "cwd", "working_directory");
  const extraArgs = testArg(args, "extraArgs", "extra_args");
  const mode = resolveGateMode(args.mode);

  const refused =
    gateRefusedReason(extraArgs) ?? destructiveBuildReason(extraArgs);
  if (refused) {
    return [{ name: "Build", description: "refused", content: refused }];
  }

  const dirUri = await actionDirUri(args, extras);
  const canProbe = typeof extras.ide.subprocess === "function";
  const which = (binary: string) =>
    binaryOnPath(extras.ide.subprocess.bind(extras.ide), binary);
  if (canProbe && !(await which("cargo"))) {
    return [missingCargoItem()];
  }

  let scriptText = "";
  if (dirUri) {
    try {
      const scriptUri = joinPathsToUri(dirUri, "scripts", "pre-commit.sh");
      if (await extras.ide.fileExists(scriptUri)) {
        scriptText = await extras.ide.readFile(scriptUri);
      }
    } catch {
      scriptText = "";
    }
  }
  const bashOk =
    process.platform !== "win32" || (canProbe && (await which("bash")));
  const usedScript = looksLikeCargoGateScript(scriptText) && bashOk;

  const fix = /(?:^|\s)--fix\b/.test(extraArgs);
  const offline = /(?:^|\s)--offline\b/.test(extraArgs);
  const command = usedScript
    ? composeGateScriptCommand({ mode, extraArgs })
    : composeFallbackGateCommand({ mode, fix, offline });

  const items = relabelTerminalAsBuild(
    await runTerminalCommandImpl(
      {
        command,
        working_directory: cwdArg || undefined,
        block_until_ms: SHELL_WAIT_HARD_CAP_MS,
      },
      streamed,
    ),
  );
  const log = items.map((item) => item.content ?? "").join("\n");
  if (/Status:\s*running/i.test(log)) {
    return [
      ...items,
      {
        name: RUST_GATE_MARKER,
        description: "still running",
        content:
          "The gate is still running in the background. Use the await-shell tool to wait; do not report results yet.",
      },
    ];
  }
  const verdict = formatGateVerdict(log, { usedScript, mode });
  const notes = usedScript
    ? ""
    : ` No ${RUST_GATE_SCRIPT} in this project, so an inline cargo chain ran. \`builtin_build action=gate_init\` installs the reusable gate script.`;
  return [
    ...attachBuildDiagnostics(items),
    {
      name: RUST_GATE_MARKER,
      description: verdict.description,
      content: `${verdict.content}${notes}`,
    },
  ];
}

/** `action: "gate_init"` — install the bundled gate script into the project. */
async function runGateInitAction(
  args: Record<string, unknown>,
  extras: Parameters<ToolImpl>[1],
  streamed: Parameters<ToolImpl>[1],
): Promise<ContextItem[]> {
  const cwdArg = testArg(args, "cwd", "working_directory");
  const force = args.force === true;
  const dirUri = await actionDirUri(args, extras);
  if (!dirUri) {
    return [
      {
        name: RUST_GATE_MARKER,
        description: "no workspace",
        content: "No workspace folder is open; cannot install the gate script.",
      },
    ];
  }
  const scriptUri = joinPathsToUri(dirUri, "scripts", "pre-commit.sh");
  let exists = false;
  try {
    exists = await extras.ide.fileExists(scriptUri);
  } catch {
    exists = false;
  }
  if (exists && !force) {
    return [
      {
        name: RUST_GATE_MARKER,
        description: "already installed",
        content: `${RUST_GATE_SCRIPT} already exists; left unchanged. Run it with \`builtin_build action=gate\`. Pass force: true only if the user asked to replace it.`,
      },
    ];
  }
  const script = readBundledGateScript();
  if (!script) {
    return [
      {
        name: RUST_GATE_MARKER,
        description: "bundle missing",
        content:
          "The bundled gate script is missing from this Knox build. Use `builtin_build action=gate` (inline fallback) instead.",
      },
    ];
  }
  await extras.ide.writeFile(scriptUri, script);
  if (process.platform !== "win32") {
    await runTerminalCommandImpl(
      {
        command: `chmod +x ${RUST_GATE_SCRIPT}`,
        working_directory: cwdArg || undefined,
        block_until_ms: 15_000,
      },
      streamed,
    ).catch(() => []);
  }
  return [
    {
      name: RUST_GATE_MARKER,
      description: exists ? "replaced" : "installed",
      content: [
        `${exists ? "Replaced" : "Installed"} ${RUST_GATE_SCRIPT} (auto-discovers Cargo crates: fmt, check, clippy, test).`,
        "Run it with `builtin_build action=gate` (mode: quick | full | strict).",
        `To enforce it on commit the USER runs \`${RUST_GATE_SCRIPT} --install-hook\` — never do that yourself.`,
      ].join(" "),
    },
  ];
}

export const buildImpl: ToolImpl = async (args, extras) => {
  const streamed = extrasWithBuildStream(extras);
  const actionName =
    args && typeof args === "object" && typeof args.action === "string"
      ? args.action.trim().toLowerCase()
      : "";
  if (actionName === "gate") {
    return runGateAction(args as Record<string, unknown>, extras, streamed);
  }
  if (actionName === "gate_init") {
    return runGateInitAction(args as Record<string, unknown>, extras, streamed);
  }
  if (actionName === "test") {
    return runTestAction(args as Record<string, unknown>, extras, streamed);
  }
  const explain =
    args && typeof args === "object" && typeof args.explain === "string"
      ? rustcExplainCommand(args.explain)
      : undefined;
  if (explain) {
    const items = await runTerminalCommandImpl(
      {
        command: explain,
        block_until_ms: 15_000,
      },
      streamed,
    );
    return relabelTerminalAsBuild(items);
  }

  const docSymbol =
    args && typeof args === "object"
      ? cargoDocSymbol(args as Record<string, unknown>)
      : undefined;
  if (docSymbol !== undefined) {
    return rustdocLookupItems(extras, docSymbol);
  }

  const detected = await detectBuildCommand(extras.ide);
  const cargoArgs =
    args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const action =
    typeof cargoArgs.action === "string" ? cargoArgs.action.trim() : "";
  const command =
    composeCargoActionCommand(action, cargoArgs) ??
    composeBuildCommand(cargoArgs, detected ?? "make");
  const forbidden = destructiveBuildReason(
    [command, args?.target, args?.extraArgs, args?.extra_args]
      .filter((part) => typeof part === "string")
      .join(" "),
  );
  if (forbidden) {
    return [
      {
        name: "Build",
        description: "refused",
        content: forbidden,
      },
    ];
  }

  const env =
    args?.env && typeof args.env === "object" && !Array.isArray(args.env)
      ? (args.env as Record<string, unknown>)
      : {};
  let arch = typeof env.ARCH === "string" ? env.ARCH : undefined;
  const crossCompile =
    typeof env.CROSS_COMPILE === "string" ? env.CROSS_COMPILE : undefined;
  if (!arch) {
    try {
      const dirs = await extras.ide.getWorkspaceDirs();
      const configUri = joinPathsToUri(dirs[0] ?? "", ".config");
      if (dirs[0] && (await extras.ide.fileExists(configUri))) {
        const text = await extras.ide.readFile(configUri);
        arch = inferArchFromConfig(text);
      }
    } catch {
      // Missing .config is fine for non-kernel trees.
    }
  }
  const which = (binary: string) =>
    binaryOnPath(extras.ide.subprocess.bind(extras.ide), binary);
  if (isCargoCommand(command)) {
    const hasCargo = await which("cargo");
    if (!hasCargo) {
      return [
        {
          name: "Build",
          description: "missing cargo",
          content: [
            "cargo not found on PATH.",
            "Install rustup from https://rustup.rs/ (provides cargo and rustc).",
            "builtin_build did not start cargo (avoiding a missing-toolchain log).",
          ].join("\n"),
        },
      ];
    }
    const missingCargoPlugin = await missingOptionalCargoPlugin(action, which);
    if (missingCargoPlugin) {
      return [missingCargoPlugin];
    }
  }
  const missing = await findMissingCrossCompiler({
    arch,
    crossCompile,
    which,
  });
  if (missing) {
    return [
      {
        name: "Build",
        description: "missing cross compiler",
        content: missing,
      },
    ];
  }

  const cwd = args?.cwd ?? args?.working_directory;
  const items = await runTerminalCommandImpl(
    {
      command,
      working_directory: typeof cwd === "string" ? cwd : undefined,
      // Compile oracle waits up to the shell hard cap, then backgrounds.
      block_until_ms: SHELL_WAIT_HARD_CAP_MS,
    },
    streamed,
  );

  return attachBuildDiagnostics(relabelTerminalAsBuild(items));
};
