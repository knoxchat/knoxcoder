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
import {
  formatDocLookupFallback,
  lookupRustdocSymbol,
} from "../build/rustdoc";

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

export const buildImpl: ToolImpl = async (args, extras) => {
  const streamed = extrasWithBuildStream(extras);
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
