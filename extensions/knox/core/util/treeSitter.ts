import fs from "node:fs";
import path from "path";

import { Language, type Node, Parser, Query, type Tree } from "web-tree-sitter";

import { FileSymbolMap, IDE, SymbolWithRange } from "..";

import { getUriFileExtension } from "./uri";
import { headerLooksLikeCpp } from "./systemsSignatures";

export enum LanguageName {
  CPP = "cpp",
  C_SHARP = "c_sharp",
  C = "c",
  CSS = "css",
  PHP = "php",
  BASH = "bash",
  JSON = "json",
  TYPESCRIPT = "typescript",
  TSX = "tsx",
  ELM = "elm",
  JAVASCRIPT = "javascript",
  PYTHON = "python",
  ELISP = "elisp",
  ELIXIR = "elixir",
  GO = "go",
  EMBEDDED_TEMPLATE = "embedded_template",
  HTML = "html",
  JAVA = "java",
  LUA = "lua",
  OCAML = "ocaml",
  QL = "ql",
  RESCRIPT = "rescript",
  RUBY = "ruby",
  RUST = "rust",
  SYSTEMRDL = "systemrdl",
  TOML = "toml",
  SOLIDITY = "solidity",
}

export const supportedLanguages: { [key: string]: LanguageName } = {
  cpp: LanguageName.CPP,
  hpp: LanguageName.CPP,
  cc: LanguageName.CPP,
  cxx: LanguageName.CPP,
  hxx: LanguageName.CPP,
  cp: LanguageName.CPP,
  hh: LanguageName.CPP,
  inc: LanguageName.CPP,
  // Depended on this PR: https://github.com/tree-sitter/tree-sitter-cpp/pull/173
  // ccm: LanguageName.CPP,
  // c++m: LanguageName.CPP,
  // cppm: LanguageName.CPP,
  // cxxm: LanguageName.CPP,
  cs: LanguageName.C_SHARP,
  c: LanguageName.C,
  h: LanguageName.C,
  /** GNU as / kernel `.S` — C wasm as preprocessor fallback; repo map also uses heuristic macros. */
  s: LanguageName.C,
  asm: LanguageName.C,
  css: LanguageName.CSS,
  php: LanguageName.PHP,
  phtml: LanguageName.PHP,
  php3: LanguageName.PHP,
  php4: LanguageName.PHP,
  php5: LanguageName.PHP,
  php7: LanguageName.PHP,
  phps: LanguageName.PHP,
  "php-s": LanguageName.PHP,
  bash: LanguageName.BASH,
  sh: LanguageName.BASH,
  json: LanguageName.JSON,
  ts: LanguageName.TYPESCRIPT,
  mts: LanguageName.TYPESCRIPT,
  cts: LanguageName.TYPESCRIPT,
  tsx: LanguageName.TSX,
  // vue: LanguageName.VUE,  // tree-sitter-vue parser is broken
  // The .wasm file being used is faulty, and yaml is split line-by-line anyway for the most part
  // yaml: LanguageName.YAML,
  // yml: LanguageName.YAML,
  elm: LanguageName.ELM,
  js: LanguageName.JAVASCRIPT,
  jsx: LanguageName.JAVASCRIPT,
  mjs: LanguageName.JAVASCRIPT,
  cjs: LanguageName.JAVASCRIPT,
  py: LanguageName.PYTHON,
  // ipynb: LanguageName.PYTHON, // It contains Python, but the file format is a ton of JSON.
  pyw: LanguageName.PYTHON,
  pyi: LanguageName.PYTHON,
  el: LanguageName.ELISP,
  emacs: LanguageName.ELISP,
  ex: LanguageName.ELIXIR,
  exs: LanguageName.ELIXIR,
  go: LanguageName.GO,
  eex: LanguageName.EMBEDDED_TEMPLATE,
  heex: LanguageName.EMBEDDED_TEMPLATE,
  leex: LanguageName.EMBEDDED_TEMPLATE,
  html: LanguageName.HTML,
  htm: LanguageName.HTML,
  java: LanguageName.JAVA,
  lua: LanguageName.LUA,
  luau: LanguageName.LUA,
  ocaml: LanguageName.OCAML,
  ml: LanguageName.OCAML,
  mli: LanguageName.OCAML,
  ql: LanguageName.QL,
  res: LanguageName.RESCRIPT,
  resi: LanguageName.RESCRIPT,
  rb: LanguageName.RUBY,
  erb: LanguageName.RUBY,
  rs: LanguageName.RUST,
  rdl: LanguageName.SYSTEMRDL,
  toml: LanguageName.TOML,
  sol: LanguageName.SOLIDITY,

  // jl: LanguageName.JULIA,
  // swift: LanguageName.SWIFT,
  // kt: LanguageName.KOTLIN,
  // scala: LanguageName.SCALA,
};

export const IGNORE_PATH_PATTERNS: Partial<Record<LanguageName, RegExp[]>> = {
  [LanguageName.TYPESCRIPT]: [/.*node_modules/],
  [LanguageName.JAVASCRIPT]: [/.*node_modules/],
};

let treeSitterAssetRoot: string | undefined;

/** Extension install path so WASM/queries resolve after the host bundle (T5.6). */
export function setTreeSitterAssetRoot(root: string | undefined): void {
  treeSitterAssetRoot = root && root.length > 0 ? root : undefined;
}

function dirnameRoots(): string[] {
  const roots: string[] = [];
  try {
    if (typeof __dirname === "string" && __dirname.length > 0) {
      roots.push(__dirname);
    }
  } catch {
    // ESM runtimes may not define __dirname
  }
  if (treeSitterAssetRoot) {
    roots.push(treeSitterAssetRoot);
    roots.push(path.join(treeSitterAssetRoot, "dist"));
    roots.push(path.join(treeSitterAssetRoot, "dist", "src"));
  }
  return roots;
}

function firstExisting(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function locateTreeSitterWasm(scriptName: string): string {
  const file = path.basename(scriptName);
  const found = firstExisting(
    dirnameRoots().flatMap((root) => [
      path.join(root, file),
      path.join(root, "src", file),
    ]),
  );
  return found ?? scriptName;
}

export async function getParserForFile(
  filepath: string,
  contents?: string,
): Promise<Parser | undefined> {
  try {
    await Parser.init({
      locateFile: (url: string) => locateTreeSitterWasm(url),
    } as { locateFile?: (url: string) => string });
    const parser = new Parser();

    const language = await getLanguageForFile(filepath, contents);
    if (!language) {
      return undefined;
    }

    parser.setLanguage(language);

    return parser;
  } catch (e) {
    console.debug("Unable to load language for file", filepath, e);
    return undefined;
  }
}

// Loading the wasm files to create a Language object is an expensive operation and with
// sufficient number of files can result in errors, instead keep a map of language name
// to Language object
const nameToLanguage = new Map<string, Language>();

export async function getLanguageForFile(
  filepath: string,
  contents?: string,
): Promise<Language | undefined> {
  try {
    const extension = getUriFileExtension(filepath);
    let languageName = supportedLanguages[extension];
    if (
      extension === "h" &&
      typeof contents === "string" &&
      headerLooksLikeCpp(contents)
    ) {
      languageName = LanguageName.CPP;
    }
    if (!languageName) {
      return undefined;
    }
    let language = nameToLanguage.get(languageName);

    if (!language) {
      const loadExt =
        languageName === LanguageName.CPP && extension === "h" ? "hpp" : extension;
      language = await loadLanguageForFileExt(loadExt);
      nameToLanguage.set(languageName, language);
    }
    return language;
  } catch (e) {
    console.debug("Unable to load language for file", filepath, e);
    return undefined;
  }
}

export const getFullLanguageName = (filepath: string) => {
  const extension = getUriFileExtension(filepath);
  return supportedLanguages[extension];
};

export async function getQueryForFile(
  filepath: string,
  queryPath: string,
): Promise<Query | undefined> {
  const language = await getLanguageForFile(filepath);
  if (!language) {
    return undefined;
  }

  const sourcePath = firstExisting(
    dirnameRoots().flatMap((root) => [
      path.join(root, "..", "tree-sitter", queryPath),
      path.join(root, "tree-sitter", queryPath),
      path.join(root, "..", "tag-qry", queryPath),
      path.join(root, "tag-qry", queryPath),
    ]),
  );
  if (!sourcePath) {
    return undefined;
  }
  const querySource = fs.readFileSync(sourcePath).toString();

  const query = new Query(language, querySource);
  return query;
}

async function loadLanguageForFileExt(
  fileExtension: string,
): Promise<Language> {
  const fileName = `tree-sitter-${supportedLanguages[fileExtension]}.wasm`;
  const wasmPath = firstExisting(
    dirnameRoots().flatMap((root) => [
      path.join(root, "tree-sitter-wasms", fileName),
      path.join(root, "src", "tree-sitter-wasms", fileName),
      path.join(root, "node_modules", "tree-sitter-wasms", "out", fileName),
    ]),
  );
  if (!wasmPath) {
    throw new Error(`tree-sitter WASM not found: ${fileName}`);
  }
  return await Language.load(wasmPath);
}

// See https://tree-sitter.github.io/tree-sitter/using-parsers
const GET_SYMBOLS_FOR_NODE_TYPES: Node["type"][] = [
  "class_declaration",
  "class_definition",
  "function_item", // function name = first "identifier" child
  "function_definition",
  "method_declaration", // method name = first "identifier" child
  "method_definition",
  "generator_function_declaration",
  // property_identifier
  // field_declaration
  // "arrow_function",
];

export async function getSymbolsForFile(
  filepath: string,
  contents: string,
): Promise<SymbolWithRange[] | undefined> {
  const parser = await getParserForFile(filepath, contents);
  if (!parser) {
    return;
  }

  let tree: Tree | null;
  try {
    tree = parser.parse(contents);
  } catch (e) {
    console.log(`Error parsing file: ${filepath}`);
    return;
  }
  
  if (!tree) {
    return;
  }
  // console.log(`file: ${filepath}`);

  // Function to recursively find all named nodes (classes and functions)
  const symbols: SymbolWithRange[] = [];
  function findNamedNodesRecursive(node: Node) {
    // console.log(`node: ${node.type}, ${node.text}`);
    if (GET_SYMBOLS_FOR_NODE_TYPES.includes(node.type)) {
      // console.log(`parent: ${node.type}, ${node.text.substring(0, 200)}`);
      // node.children.forEach((child) => {
      //   console.log(`child: ${child.type}, ${child.text}`);
      // });

      // Empirically, the actual name is the last identifier in the node
      // Especially with languages where return type is declared before the name
      // TODO use findLast in newer version of node target
      let identifier: Node | undefined = undefined;
      for (let i = node.children.length - 1; i >= 0; i--) {
        const child = node.children[i];
        if (
          child &&
          (child.type === "identifier" ||
          child.type === "property_identifier")
        ) {
          identifier = child;
          break;
        }
      }

      if (identifier?.text) {
        symbols.push({
          filepath,
          type: node.type,
          name: identifier.text,
          range: {
            start: {
              character: node.startPosition.column,
              line: node.startPosition.row,
            },
            end: {
              character: node.endPosition.column + 1,
              line: node.endPosition.row + 1,
            },
          },
          content: node.text,
        });
      }
    }
    node.children.forEach((child) => {
      if (child) {
        findNamedNodesRecursive(child);
      }
    });
  }
  findNamedNodesRecursive(tree.rootNode);
  return symbols;
}

export async function getSymbolsForManyFiles(
  uris: string[],
  ide: IDE,
): Promise<FileSymbolMap> {
  const filesAndSymbols = await Promise.all(
    uris.map(async (uri): Promise<[string, SymbolWithRange[]]> => {
      const contents = await ide.readFile(uri);
      let symbols = undefined;
      try {
        symbols = await getSymbolsForFile(uri, contents);
      } catch (e) {
        console.error(`Failed to get symbols for ${uri}:`, e);
      }
      return [uri, symbols ?? []];
    }),
  );
  return Object.fromEntries(filesAndSymbols);
}
