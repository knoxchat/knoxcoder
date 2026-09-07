import { getAst } from "core/util/ast";
import { LanguageInfo } from "core/util/languageInfo";
import { intersection } from "core/util/ranges";
import * as URI from "core/util/uriApi";
import * as vscode from "vscode";

import type { IDE, Range, RangeInFile, RangeInFileWithContents } from "core";
import type { Node } from "web-tree-sitter";

const FUNCTION_DECLARATION_NODE_TYPEs = [
  "function_declaration",
  "function_definition",
  "method_declaration",
  "method_definition",
  "arrow_function",
  "function_expression",
  "generator_function_declaration",
];

const FUNCTION_BLOCK_NODE_TYPES = [
  "block",
  "compound_statement",
  "statement_block",
  "body",
];

type GotoProviderName =
  | "vscode.executeDefinitionProvider"
  | "vscode.executeTypeDefinitionProvider"
  | "vscode.executeDeclarationProvider"
  | "vscode.executeImplementationProvider"
  | "vscode.executeReferenceProvider";

interface GotoInput {
  uri: vscode.Uri;
  line: number;
  character: number;
  name: GotoProviderName;
}

function gotoInputKey(input: GotoInput) {
  return `${input.name}${input.uri.toString()}${input.line}${input.character}`;
}

const MAX_CACHE_SIZE = 500;
const gotoCache = new Map<string, RangeInFile[]>();

export async function executeGotoProvider(
  input: GotoInput,
): Promise<RangeInFile[]> {
  const cacheKey = gotoInputKey(input);
  const cached = gotoCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const definitions = (await vscode.commands.executeCommand(
      input.name,
      input.uri,
      new vscode.Position(input.line, input.character),
    )) as any;

    const results = definitions
      .filter((d: any) => (d.targetUri || d.uri) && (d.targetRange || d.range))
      .map((d: any) => ({
        filepath: (d.targetUri || d.uri).toString(),
        range: d.targetRange || d.range,
      }));

    if (gotoCache.size >= MAX_CACHE_SIZE) {
      const oldestKey = gotoCache.keys().next().value;
      if (oldestKey) {
        gotoCache.delete(oldestKey);
      }
    }
    gotoCache.set(cacheKey, results);

    return results;
  } catch (e) {
    console.warn(`Error executing ${input.name}:`, e);
    return [];
  }
}

function isRifWithContents(
  rif: RangeInFile | RangeInFileWithContents,
): rif is RangeInFileWithContents {
  return typeof (rif as any).contents === "string";
}

function findChildren(
  node: Node,
  predicate: (n: Node) => boolean,
  firstN?: number,
): Node[] {
  let matchingNodes: Node[] = [];

  if (firstN && firstN <= 0) {
    return [];
  }

  if (predicate(node)) {
    matchingNodes.push(node);
  }

  for (const child of node.children) {
    if (!child) continue;

    matchingNodes = matchingNodes.concat(
      findChildren(
        child,
        predicate,
        firstN ? firstN - matchingNodes.length : undefined,
      ),
    );
  }

  return matchingNodes;
}

function findTypeIdentifiers(node: Node): Node[] {
  return findChildren(
    node,
    (childNode) =>
      childNode.type === "type_identifier" ||
      (["ERROR"].includes(childNode.parent?.type ?? "") &&
        childNode.type === "identifier" &&
        childNode.text[0].toUpperCase() === childNode.text[0]),
  );
}

async function crawlTypes(
  rif: RangeInFile | RangeInFileWithContents,
  ide: IDE,
  depth: number = 1,
  results: RangeInFileWithContents[] = [],
  searchedLabels: Set<string> = new Set(),
): Promise<RangeInFileWithContents[]> {
  const contents = isRifWithContents(rif)
    ? rif.contents
    : await ide.readFile(rif.filepath);

  const ast = await getAst(rif.filepath, contents);
  if (!ast) {
    return results;
  }
  const astLineCount = ast.rootNode.text.split("\n").length;

  const identifierNodes = findTypeIdentifiers(ast.rootNode).filter(
    (node) => !searchedLabels.has(node.text),
  );
  identifierNodes.forEach((node) => searchedLabels.add(node.text));

  const definitions = [];

  for (const node of identifierNodes) {
    const [typeDef] = await executeGotoProvider({
      uri: vscode.Uri.parse(rif.filepath),
      line:
        rif.range.start.line +
        Math.min(node.startPosition.row, astLineCount - 1),
      character: rif.range.start.character + node.startPosition.column,
      name: "vscode.executeDefinitionProvider",
    });

    if (!typeDef) {
      definitions.push(undefined);
      continue;
    }

    const typeContents = await ide.readRangeInFile(
      typeDef.filepath,
      typeDef.range,
    );

    definitions.push({
      ...typeDef,
      contents: typeContents,
    });
  }

  for (const definition of definitions) {
    if (
      !definition ||
      results.some(
        (result) =>
          URI.equal(result.filepath, definition.filepath) &&
          intersection(result.range, definition.range) !== null,
      )
    ) {
      continue;
    }
    results.push(definition);
  }

  if (depth > 0) {
    for (const result of [...results]) {
      await crawlTypes(result, ide, depth - 1, results, searchedLabels);
    }
  }

  return results;
}

export async function getDefinitionsForNode(
  uri: vscode.Uri,
  node: Node,
  ide: IDE,
  lang: LanguageInfo,
): Promise<RangeInFileWithContents[]> {
  const ranges: (RangeInFile | RangeInFileWithContents)[] = [];
  switch (node.type) {
    case "call_expression": {
      const [funDef] = await executeGotoProvider({
        uri,
        line: node.startPosition.row,
        character: node.startPosition.column,
        name: "vscode.executeDefinitionProvider",
      });
      if (!funDef) {
        return [];
      }

      let funcText = await ide.readRangeInFile(funDef.filepath, funDef.range);
      if (funcText.split("\n").length > 15) {
        let truncated = false;
        const funRootAst = await getAst(funDef.filepath, funcText);
        if (funRootAst) {
          const [funNode] = findChildren(
            funRootAst?.rootNode,
            (node) => FUNCTION_DECLARATION_NODE_TYPEs.includes(node.type),
            1,
          );
          if (funNode) {
            const [statementBlockNode] = findChildren(
              funNode,
              (node) => FUNCTION_BLOCK_NODE_TYPES.includes(node.type),
              1,
            );
            if (statementBlockNode) {
              funcText = funRootAst.rootNode.text
                .slice(0, statementBlockNode.startIndex)
                .trim();
              truncated = true;
            }
          }
        }
        if (!truncated) {
          funcText = funcText.split("\n")[0];
        }
      }

      ranges.push(funDef);

      const typeDefs = await crawlTypes(
        {
          ...funDef,
          contents: funcText,
        },
        ide,
      );
      ranges.push(...typeDefs);
      break;
    }
    case "new_expression": {
      const classNameNode = node.children.find(
        (child) => child && child.type === "identifier",
      );
      const [classDef] = await executeGotoProvider({
        uri,
        line: (classNameNode ?? node).endPosition.row,
        character: (classNameNode ?? node).endPosition.column,
        name: "vscode.executeDefinitionProvider",
      });
      if (!classDef) {
        break;
      }
      const contents = await ide.readRangeInFile(
        classDef.filepath,
        classDef.range,
      );

      ranges.push({
        ...classDef,
        contents: `${
          classNameNode?.text
            ? `${lang.singleLineComment} ${classNameNode.text}:\n`
            : ""
        }${contents.trim()}`,
      });

      const definitions = await crawlTypes({ ...classDef, contents }, ide);
      ranges.push(...definitions.filter(Boolean));

      break;
    }
  }
  return await Promise.all(
    ranges.map(async (rif) => {
      const range: Range = {
        start: {
          line: rif.range.start.line,
          character: rif.range.start.character,
        },
        end: {
          line: rif.range.end.line,
          character: rif.range.end.character,
        },
      };
      rif.range = range;

      if (!isRifWithContents(rif)) {
        return {
          ...rif,
          contents: await ide.readRangeInFile(rif.filepath, rif.range),
        };
      }
      return rif;
    }),
  );
}
