import { ContextItem } from "../..";
import { joinPathsToUri } from "../../util/uri";
import { ToolImpl } from ".";

const LIST_CAP = 40;
const SEARCH_CAP = 30;

export function normalizeConfigSymbol(raw: string): string {
  const trimmed = raw.trim().replace(/^CONFIG_/, "");
  return trimmed ? `CONFIG_${trimmed}` : "";
}

export function parseConfigValue(configText: string, symbol: string): string | undefined {
  const name = normalizeConfigSymbol(symbol);
  if (!name) {
    return undefined;
  }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const unset = new RegExp(`^# ${escaped} is not set\\s*$`, "m");
  if (unset.test(configText)) {
    return "n (not set)";
  }
  const set = new RegExp(`^${escaped}=(.*)`, "m");
  const match = configText.match(set);
  if (!match) {
    return undefined;
  }
  return match[1].trim();
}

export function listConfigSymbols(
  configText: string,
  prefix: string,
  cap = LIST_CAP,
): { lines: string[]; truncated: boolean } {
  const want = normalizeConfigSymbol(prefix) || "CONFIG_";
  const lines: string[] = [];
  for (const line of configText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const hits =
      trimmed.startsWith(want) || trimmed.startsWith(`# ${want}`);
    if (!hits) {
      continue;
    }
    lines.push(trimmed);
    if (lines.length >= cap) {
      return { lines, truncated: true };
    }
  }
  return { lines, truncated: false };
}

function opOf(args: Record<string, unknown>): string {
  const raw = args.op ?? args.action;
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

async function readDotConfig(
  extras: Parameters<ToolImpl>[1],
  pathArg?: string,
): Promise<{ uri: string; text: string } | { error: string }> {
  const dirs = await extras.ide.getWorkspaceDirs();
  const root = dirs[0];
  if (!root) {
    return { error: "No workspace." };
  }
  const candidates = pathArg
    ? [pathArg, joinPathsToUri(root, pathArg)]
    : [joinPathsToUri(root, ".config")];
  for (const uri of candidates) {
    try {
      if (await extras.ide.fileExists(uri)) {
        const text = await extras.ide.readFile(uri);
        return { uri, text };
      }
    } catch {
      continue;
    }
  }
  return {
    error:
      "No .config found. Configure the kernel (make defconfig / olddefconfig) first. Do not dump Kconfig via menuconfig.",
  };
}

async function scriptsConfigHint(
  extras: Parameters<ToolImpl>[1],
  symbol: string,
): Promise<string> {
  const dirs = await extras.ide.getWorkspaceDirs();
  const root = dirs[0];
  if (!root) {
    return "";
  }
  const scriptUri = joinPathsToUri(root, "scripts/config");
  try {
    if (await extras.ide.fileExists(scriptUri)) {
      return `\n\nscripts/config is present: \`scripts/config --file .config --state ${symbol.replace(/^CONFIG_/, "")}\``;
    }
  } catch {
    return "";
  }
  return "";
}

export const kconfigImpl: ToolImpl = async (args, extras) => {
  const op = opOf(args ?? {});
  if (!op) {
    return [
      {
        name: "Kconfig",
        description: "invalid op",
        content: "Missing op. Use get, search, or list.",
      },
    ];
  }

  const symbolRaw =
    typeof args.symbol === "string"
      ? args.symbol
      : typeof args.query === "string"
        ? args.query
        : "";
  const pathArg = typeof args.path === "string" ? args.path.trim() : "";

  if (op === "get") {
    const symbol = normalizeConfigSymbol(symbolRaw);
    if (!symbol) {
      return [
        {
          name: "Kconfig",
          description: "missing symbol",
          content: "get needs symbol=CONFIG_FOO (or FOO).",
        },
      ];
    }
    const loaded = await readDotConfig(extras, pathArg || undefined);
    if ("error" in loaded) {
      return [{ name: "Kconfig", description: "missing .config", content: loaded.error }];
    }
    const value = parseConfigValue(loaded.text, symbol);
    const hint = await scriptsConfigHint(extras, symbol);
    if (value === undefined) {
      return [
        {
          name: "Kconfig",
          description: "not found",
          content: `${symbol} is not in .config.${hint}`,
        },
      ];
    }
    return [
      {
        name: "Kconfig",
        description: symbol,
        content: `${symbol}=${value}${hint}`,
      },
    ];
  }

  if (op === "list") {
    const prefixRaw =
      typeof args.prefix === "string" && args.prefix.trim()
        ? args.prefix
        : symbolRaw;
    const loaded = await readDotConfig(extras, pathArg || undefined);
    if ("error" in loaded) {
      return [{ name: "Kconfig", description: "missing .config", content: loaded.error }];
    }
    const { lines, truncated } = listConfigSymbols(loaded.text, prefixRaw);
    const footer = truncated
      ? `\ntruncated at ${LIST_CAP}; pass a narrower prefix`
      : "";
    return [
      {
        name: "Kconfig",
        description: "list",
        content:
          (lines.length ? lines.join("\n") : "(no matching CONFIG_* symbols)") +
          footer,
      },
    ];
  }

  if (op === "search") {
    const query = symbolRaw.trim() || (typeof args.prefix === "string" ? args.prefix : "");
    if (!query) {
      return [
        {
          name: "Kconfig",
          description: "missing query",
          content: "search needs symbol=CONFIG_FOO (or a Kconfig identifier).",
        },
      ];
    }
    const dirs = await extras.ide.getWorkspaceDirs();
    const root = dirs[0];
    const searchPath = pathArg || ".";
    let hits = "";
    if (typeof extras.ide.getSearchResults === "function") {
      hits = await extras.ide.getSearchResults(query.replace(/^CONFIG_/, ""), {
        path: searchPath === "." ? undefined : searchPath,
        fileGlob: "*Kconfig*",
        maxResults: SEARCH_CAP,
      });
    }
    const items: ContextItem[] = [
      {
        name: "Kconfig",
        description: "search",
        content:
          hits.trim() ||
          `No Kconfig hits for ${query}. Try builtin_exact_search query=${query} fileGlob=*Kconfig*.`,
      },
    ];
    if (root) {
      const hint = await scriptsConfigHint(extras, normalizeConfigSymbol(query));
      if (hint) {
        items[0].content += hint;
      }
    }
    return items;
  }

  return [
    {
      name: "Kconfig",
      description: "invalid op",
      content: `Unknown op ${op}. Use get, search, or list.`,
    },
  ];
};
