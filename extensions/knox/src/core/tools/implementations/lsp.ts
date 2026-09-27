/**
 * LSP tool implementation.
 *
 * Routes LSP operations through the IDE interface, which in VS Code
 * uses the built-in language server infrastructure via `vscode.commands.executeCommand`.
 *
 * Mirrors opencode's LspTool (opencode/src/tool/lsp.ts) behavior:
 *  - Same operations: goToDefinition, findReferences, hover, documentSymbol,
 *    workspaceSymbol, goToImplementation, prepareCallHierarchy, incomingCalls,
 *    outgoingCalls
 *  - Position ops use 1-based line/character
 *  - workspaceSymbol takes `query` (not an empty string)
 */

import * as path from "path";
import { pathToFileURL } from "url";
import { ContextItem, ToolExtras } from "../..";
import { ToolImpl } from "./index";
import {
  LspOperation,
  lspOperationNeedsFile,
  lspOperationNeedsPosition,
} from "../definitions/lsp";
import {
  findCompileCommandsUri,
  formatLspFailureAdvice,
  isCLikeLspPath,
} from "../compileCommands";
import { isRustLanguagePath } from "../postEditVerification";
import { queryWorkspaceTagsOrCscope } from "../tagsQuery";
import { detectSystemsWorkspace } from "../../config/agentProfile";

interface LspArgs {
  operation: LspOperation;
  query?: string;
  filePath?: string;
  line?: number;
  character?: number;
}

function missingParam(name: string, operation: string): ContextItem[] {
  return [
    {
      name: "LSP Error",
      description: `Missing ${name}`,
      content: `LSP ${operation} requires ${name}.`,
    },
  ];
}

function isEmptyLspResult(result: unknown): boolean {
  if (result === null || result === undefined) {
    return true;
  }
  if (Array.isArray(result) && result.length === 0) {
    return true;
  }
  if (typeof result === "string" && result.trim().length === 0) {
    return true;
  }
  return false;
}

async function appendLspAdvice(
  extras: ToolExtras,
  items: ContextItem[],
  opts: {
    error?: unknown;
    empty: boolean;
    filePath?: string;
    viaTags?: boolean;
    systemsLike?: boolean;
  },
): Promise<ContextItem[]> {
  const compileUri = await findCompileCommandsUri(extras.ide, opts.filePath);
  const isRust = isRustLanguagePath(opts.filePath ?? "");
  const advice = formatLspFailureAdvice({
    error: opts.error,
    emptyResult: opts.empty,
    isCLike:
      !isRust && (isCLikeLspPath(opts.filePath) || Boolean(opts.systemsLike)),
    isRust,
    hasCompileCommands: Boolean(compileUri),
    viaTags: opts.viaTags,
  });
  if (!advice || items.length === 0) {
    return items;
  }
  return [
    {
      ...items[0],
      content: `${items[0].content}\n\n${advice}`,
    },
    ...items.slice(1),
  ];
}

export const lspImpl: ToolImpl = async (
  args: LspArgs,
  extras: ToolExtras,
): Promise<ContextItem[]> => {
  const { operation } = args;

  if (!operation) {
    return missingParam("operation", "unknown");
  }

  const workspaceDirs = await extras.ide.getWorkspaceDirs();
  const workspaceDir = workspaceDirs[0] || "";

  if (operation === "workspaceSymbol") {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) {
      return missingParam("query", operation);
    }
    let error: unknown;
    let result: unknown;
    try {
      result = await extras.ide.getWorkspaceSymbols(query);
    } catch (err) {
      error = err;
    }
    if (!error && !isEmptyLspResult(result)) {
      return formatLspResult(`workspaceSymbol ${query}`, operation, result);
    }
    const tags = await queryWorkspaceTagsOrCscope(extras.ide, query);
    if (tags) {
      return [
        {
          name: `workspaceSymbol ${query}`,
          description: "tags fallback",
          content: tags,
        },
      ];
    }
    const items = error
      ? lspError(operation, query, error)
      : formatLspResult(`workspaceSymbol ${query}`, operation, result);
    return appendLspAdvice(extras, items, {
      error,
      empty: true,
      filePath: args.filePath,
      systemsLike: await detectSystemsWorkspace(extras.ide),
    });
  }

  if (lspOperationNeedsFile(operation) && !args.filePath?.trim()) {
    return missingParam("filePath", operation);
  }

  const filePath = args.filePath!.trim();
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(workspaceDir, filePath);

  const exists = await extras.ide.fileExists(absolutePath);
  if (!exists) {
    return [
      {
        name: "LSP Error",
        description: `File not found: ${filePath}`,
        content: `File not found: ${absolutePath}`,
      },
    ];
  }

  const fileUri = pathToFileURL(absolutePath).href;
  const relPath = path.relative(workspaceDir, absolutePath);

  if (operation === "documentSymbol") {
    try {
      const result = await extras.ide.getDocumentSymbols(fileUri);
      const items = formatLspResult(`documentSymbol ${relPath}`, operation, result);
      return appendLspAdvice(extras, items, {
        empty: isEmptyLspResult(result),
        filePath,
      });
    } catch (error) {
      return appendLspAdvice(extras, lspError(operation, relPath, error), {
        error,
        empty: true,
        filePath,
      });
    }
  }

  if (lspOperationNeedsPosition(operation)) {
    const line = Number(args.line);
    const character = Number(args.character);
    if (!Number.isFinite(line) || line < 1) {
      return missingParam("line (1-based)", operation);
    }
    if (!Number.isFinite(character) || character < 1) {
      return missingParam("character (1-based)", operation);
    }

    const location = {
      filepath: fileUri,
      position: {
        line: line - 1,
        character: character - 1,
      },
    };
    const title = `${operation} ${relPath}:${line}:${character}`;

    try {
      let result: unknown;
      switch (operation) {
        case "goToDefinition":
          result = await extras.ide.gotoDefinition(location);
          break;
        case "findReferences":
          result = await extras.ide.findReferences(location);
          break;
        case "hover":
          result = await extras.ide.getHover(location);
          break;
        case "goToImplementation":
          result = await extras.ide.gotoImplementation(location);
          break;
        case "prepareCallHierarchy":
          result = await extras.ide.prepareCallHierarchy(location);
          break;
        case "incomingCalls":
          result = await extras.ide.getIncomingCalls(location);
          break;
        case "outgoingCalls":
          result = await extras.ide.getOutgoingCalls(location);
          break;
        default:
          return [
            {
              name: "LSP Error",
              description: `Unknown operation: ${operation}`,
              content: `Unknown LSP operation: ${operation}`,
            },
          ];
      }
      return appendLspAdvice(
        extras,
        formatLspResult(title, operation, result),
        {
          empty: isEmptyLspResult(result),
          filePath,
        },
      );
    } catch (error) {
      return appendLspAdvice(
        extras,
        lspError(operation, `${relPath}:${line}:${character}`, error),
        {
          error,
          empty: true,
          filePath,
        },
      );
    }
  }

  return [
    {
      name: "LSP Error",
      description: `Unknown operation: ${operation}`,
      content: `Unknown LSP operation: ${operation}`,
    },
  ];
};

function formatLspResult(
  title: string,
  operation: string,
  result: unknown,
): ContextItem[] {
  const output = (() => {
    if (result === null || result === undefined) {
      return `No results found for ${operation}`;
    }
    if (Array.isArray(result) && result.length === 0) {
      return `No results found for ${operation}`;
    }
    if (typeof result === "string") {
      return result || `No results found for ${operation}`;
    }
    return JSON.stringify(result, null, 2);
  })();

  return [
    {
      name: title,
      description: `LSP ${operation}`,
      content: output,
    },
  ];
}

function lspError(
  operation: string,
  where: string,
  error: unknown,
): ContextItem[] {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return [
    {
      name: "LSP Error",
      description: `Error performing ${operation}`,
      content: `Error performing LSP ${operation} on ${where}: ${errorMessage}`,
    },
  ];
}
