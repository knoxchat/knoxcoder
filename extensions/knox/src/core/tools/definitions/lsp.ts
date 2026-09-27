import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME } from "../builtIn";

/**
 * Tool name constant — matches the enum pattern used by other built-in tools.
 */
export const LSP_TOOL_NAME = "builtin_lsp";

/**
 * The supported LSP operations, matching opencode's lsp.ts exactly.
 */
export const LSP_OPERATIONS = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
] as const;

export type LspOperation = (typeof LSP_OPERATIONS)[number];

const POSITION_OPS = new Set<LspOperation>([
  "goToDefinition",
  "findReferences",
  "hover",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
]);

export function lspOperationNeedsPosition(operation: string): boolean {
  return POSITION_OPS.has(operation as LspOperation);
}

export function lspOperationNeedsFile(operation: string): boolean {
  return operation !== "workspaceSymbol";
}

/**
 * Tool description matching opencode's lsp.txt content.
 */
const LSP_DESCRIPTION = `Interact with Language Server Protocol (LSP) servers to get code intelligence features.

Supported operations:
- goToDefinition: Find where a symbol is defined
- findReferences: Find all references to a symbol
- hover: Get hover information (documentation, type info) for a symbol
- documentSymbol: Get all symbols (functions, classes, variables) in a document
- workspaceSymbol: Search for symbols across the entire workspace (requires query)
- goToImplementation: Find implementations of an interface or abstract method
- prepareCallHierarchy: Get call hierarchy item at a position (functions/methods)
- incomingCalls: Find all functions/methods that call the function at a position
- outgoingCalls: Find all functions/methods called by the function at a position

workspaceSymbol requires:
- query: Symbol name to search (e.g. copy_process)

documentSymbol requires:
- filePath: The file to inspect

All other operations require:
- filePath: The absolute or relative path to the file
- line: The line number (1-based, as shown in editors)
- character: The character offset (1-based, as shown in editors)

Note: LSP servers must be configured for the file type.
- If no language server is installed, the error says so (not a missing compile DB).
- Kernel/C trees typically need compile_commands.json for clangd. Generate it once with \`bear -- make\`, \`compiledb -n make\`, or \`python scripts/clang-tools/gen_compile_commands.py\`. Do not invent include paths.
- If clangd is not ready but \`tags\` or \`cscope.out\` exists, workspaceSymbol falls back to those (\`make tags\`).
- On Rust (.rs): hover / goToDefinition before writing a method call. rust-analyzer hover includes types (inlays). Prefer goToDefinition into dependency source over docs.rs guesses.
- If rust-analyzer is missing, empty Rust results say so — use builtin_build (cargo check) and read ~/.cargo/registry/src or vendor/. Never mention compile_commands.json for Rust.`;

/**
 * Tool definition for the LSP tool — exposes LSP operations as agent-callable tools.
 * Mirrors opencode's LspTool (opencode/src/tool/lsp.ts).
 */
export const lspTool: Tool = {
  type: "function",
  displayTitle: "LSP",
  wouldLikeTo: 'perform LSP {{{ operation }}} on "{{{ filePath }}}"',
  isCurrently: 'performing LSP {{{ operation }}} on "{{{ filePath }}}"',
  hasAlready: 'performed LSP {{{ operation }}} on "{{{ filePath }}}"',
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: LSP_TOOL_NAME,
    description: LSP_DESCRIPTION,
    parameters: {
      type: "object",
      required: ["operation"],
      properties: {
        operation: {
          type: "string",
          enum: [...LSP_OPERATIONS],
          description: "The LSP operation to perform",
        },
        query: {
          type: "string",
          description:
            "Symbol query for workspaceSymbol (e.g. copy_process). Ignored for other operations.",
        },
        filePath: {
          type: "string",
          description: "The absolute or relative path to the file",
        },
        line: {
          type: "number",
          description: "The line number (1-based, as shown in editors)",
        },
        character: {
          type: "number",
          description: "The character offset (1-based, as shown in editors)",
        },
      },
    },
  },
};
