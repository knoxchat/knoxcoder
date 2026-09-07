import { Chunk, IDE } from "core";
import { languageForFilepath } from "core/util/languageInfo";
import { deduplicateArray } from "core/util";
import { getParserForFile } from "core/util/treeSitter";
import * as vscode from "vscode";

import { getDefinitionsForNode } from "../util/lsp";

import type { Node } from "web-tree-sitter";

// Common directories to ignore when searching for definitions
const DEFAULT_IGNORE_DIRS = [
  "node_modules",
  ".git", 
  "dist",
  "build",
  "coverage",
  ".next",
  ".vscode",
  "target",
  "bin",
  "obj"
];

export async function expandSnippet(
  fileUri: string,
  startLine: number,
  endLine: number,
  ide: IDE,
): Promise<Chunk[]> {
  const parser = await getParserForFile(fileUri);
  if (!parser) {
    return [];
  }

  const fullFileContents = await ide.readFile(fileUri);
  const tree = parser.parse(fullFileContents);
  
  if (!tree) {
    return [];
  }
  
  const root: Node = tree.rootNode;

  // Find all nodes contained in the range
  const containedInRange: Node[] = [];
  const toExplore: Node[] = [root];
  while (toExplore.length > 0) {
    const node = toExplore.pop()!;
    for (const child of node.namedChildren) {
      if (!child) continue;
      
      if (
        child.startPosition.row >= startLine &&
        child.endPosition.row <= endLine
      ) {
        // Fully contained in range
        containedInRange.push(child);
        toExplore.push(child);
      } else if (
        child.startPosition.row >= startLine ||
        child.endPosition.row <= endLine
      ) {
        // Overlaps, children may be contained in range
        toExplore.push(child);
      }
    }
  }

  // Find all call expressions
  const callExpressions = containedInRange.filter(
    (node) => node.type === "call_expression",
  );
  let callExpressionDefinitions = (
    await Promise.all(
      callExpressions.map(async (node) => {
        return getDefinitionsForNode(
          vscode.Uri.parse(fileUri),
          node,
          ide,
          languageForFilepath(fileUri),
        );
      }),
    )
  ).flat();

  // De-duplicate the definitions
  callExpressionDefinitions = deduplicateArray(
    callExpressionDefinitions,
    (a, b) => {
      return (
        a.filepath === b.filepath &&
        a.range.start.line === b.range.start.line &&
        a.range.end.line === b.range.end.line &&
        a.range.start.character === b.range.start.character &&
        a.range.end.character === b.range.end.character
      );
    },
  );

  // Filter out definitions already in selected range
  callExpressionDefinitions = callExpressionDefinitions.filter((def) => {
    return !(
      def.filepath === fileUri &&
      def.range.start.line >= startLine &&
      def.range.end.line <= endLine
    );
  });

  // Filter out defintions not under workspace directories
  const workspaceDirectories = await ide.getWorkspaceDirs();
  callExpressionDefinitions = callExpressionDefinitions.filter((def) => {
    return (
      workspaceDirectories.some((dir) => def.filepath.startsWith(dir)) &&
      !DEFAULT_IGNORE_DIRS.some(
        (dir) =>
          def.filepath.includes(`/${dir}/`) ||
          def.filepath.includes(`\\${dir}\\`),
      )
    );
  });

  const chunks = await Promise.all(
    callExpressionDefinitions.map(async (def) => {
      return {
        filepath: def.filepath,
        startLine: def.range.start.line,
        endLine: def.range.end.line,
        digest: "",
        index: 0,
        content: await ide.readRangeInFile(def.filepath, def.range),
      };
    }),
  );
  return chunks;
}
