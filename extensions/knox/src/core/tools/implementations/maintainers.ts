import { ContextItem } from "../..";
import { joinPathsToUri } from "../../util/uri";
import { ToolImpl } from ".";
import {
  formatMaintainerHits,
  lookupMaintainers,
  parseMaintainers,
  searchMaintainers,
  type MaintainerRecord,
} from "../maintainersParse";

const LIST_CAP = 40;
const LOOKUP_CAP = 8;
const SEARCH_CAP = 12;

function opOf(args: Record<string, unknown>): string {
  const raw = args.op ?? args.action;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim().toLowerCase();
  }
  if (typeof args.path === "string" && args.path.trim()) {
    return "lookup";
  }
  if (typeof args.query === "string" && args.query.trim()) {
    return "search";
  }
  return "list";
}

async function readMaintainersFile(
  extras: Parameters<ToolImpl>[1],
  fileArg?: string,
): Promise<{ uri: string; text: string } | { error: string }> {
  const dirs = await extras.ide.getWorkspaceDirs();
  const root = dirs[0];
  if (!root) {
    return { error: "No workspace." };
  }
  const candidates = fileArg
    ? [fileArg, joinPathsToUri(root, fileArg)]
    : [
        joinPathsToUri(root, "MAINTAINERS"),
        joinPathsToUri(root, "MAINTAINERS.txt"),
      ];
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
      "No MAINTAINERS file at the workspace root. This tool is for Linux/QEMU trees — do not dump a random file.",
  };
}

async function getMaintainerHint(
  extras: Parameters<ToolImpl>[1],
  relPath?: string,
): Promise<string> {
  try {
    const dirs = await extras.ide.getWorkspaceDirs();
    const root = dirs[0];
    if (!root) {
      return "";
    }
    const scriptUri = joinPathsToUri(root, "scripts/get_maintainer.pl");
    if (await extras.ide.fileExists(scriptUri)) {
      const target = relPath ? ` ${relPath}` : "";
      return `\n\nscripts/get_maintainer.pl is present: \`perl scripts/get_maintainer.pl -f${target}\``;
    }
  } catch {
    return "";
  }
  return "";
}

function listTitles(
  records: MaintainerRecord[],
  prefix: string,
  cap = LIST_CAP,
): { lines: string[]; truncated: boolean } {
  const want = prefix.trim().toLowerCase();
  const lines: string[] = [];
  for (const record of records) {
    if (want && !record.title.toLowerCase().includes(want)) {
      continue;
    }
    const files = record.files.slice(0, 2).join(", ");
    lines.push(files ? `${record.title}  (${files})` : record.title);
    if (lines.length >= cap) {
      return { lines, truncated: true };
    }
  }
  return { lines, truncated: false };
}

export const maintainersImpl: ToolImpl = async (args, extras) => {
  const op = opOf(args ?? {});
  const fileArg = typeof args.file === "string" ? args.file.trim() : "";
  const pathArg =
    typeof args.path === "string"
      ? args.path.trim()
      : typeof args.filepath === "string"
        ? args.filepath.trim()
        : "";
  const queryArg =
    typeof args.query === "string"
      ? args.query.trim()
      : typeof args.symbol === "string"
        ? args.symbol.trim()
        : "";

  const loaded = await readMaintainersFile(extras, fileArg || undefined);
  if ("error" in loaded) {
    return [
      {
        name: "MAINTAINERS",
        description: "missing",
        content: loaded.error,
      },
    ];
  }
  const records = parseMaintainers(loaded.text);
  const hint = await getMaintainerHint(extras, pathArg || undefined);

  if (op === "lookup") {
    if (!pathArg) {
      return [
        {
          name: "MAINTAINERS",
          description: "missing path",
          content: "lookup needs path=mm/filemap.c (workspace-relative).",
        },
      ];
    }
    const { hits, truncated } = lookupMaintainers(records, pathArg, LOOKUP_CAP);
    return [
      {
        name: "MAINTAINERS",
        description: pathArg,
        content:
          formatMaintainerHits(hits, {
            truncated,
            cap: LOOKUP_CAP,
            empty: `No MAINTAINERS record matches ${pathArg}. Try search= or a parent directory.`,
          }) + hint,
      },
    ];
  }

  if (op === "search") {
    if (!queryArg) {
      return [
        {
          name: "MAINTAINERS",
          description: "missing query",
          content: "search needs query=mm or query=\"MEMORY MANAGEMENT\".",
        },
      ];
    }
    const { hits, truncated } = searchMaintainers(records, queryArg, SEARCH_CAP);
    return [
      {
        name: "MAINTAINERS",
        description: queryArg,
        content:
          formatMaintainerHits(hits, {
            truncated,
            cap: SEARCH_CAP,
            empty: `No MAINTAINERS record contains "${queryArg}".`,
          }) + hint,
      },
    ];
  }

  if (op === "list") {
    const { lines, truncated } = listTitles(records, queryArg);
    const footer = truncated
      ? `\ntruncated at ${LIST_CAP}; pass a narrower query`
      : "";
    return [
      {
        name: "MAINTAINERS",
        description: "list",
        content:
          (lines.length
            ? lines.join("\n")
            : "MAINTAINERS has no subsystem titles.") +
          footer +
          hint,
      },
    ];
  }

  return [
    {
      name: "MAINTAINERS",
      description: "invalid op",
      content: "Unknown op. Use lookup, search, or list.",
    },
  ];
};
