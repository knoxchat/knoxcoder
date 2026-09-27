/**
 * Dependency Graph Analyzer
 *
 * Traverses import/export chains to build a dependency subgraph rooted
 * at specified files. Used by Auto-Context to find related files that
 * should be included as context.
 */

import { IDE } from "../index.js";

export interface DependencyNode {
  /** Absolute file path */
  path: string;
  /** Files this file imports */
  imports: string[];
  /** Files that import this file */
  importedBy: string[];
  /** Distance from the root file (0 = root) */
  depth: number;
}

export interface DependencyGraph {
  /** All nodes in the graph, keyed by file path */
  nodes: Map<string, DependencyNode>;
  /** Root file paths the graph was built from */
  roots: string[];
}

// Common import patterns across languages
const IMPORT_PATTERNS: RegExp[] = [
  // ES6: import ... from "..."
  /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+)?["']([^"']+)["']/g,
  // CommonJS: require("...")
  /require\s*\(\s*["']([^"']+)["']\s*\)/g,
  // Dynamic import: import("...")
  /import\s*\(\s*["']([^"']+)["']\s*\)/g,
  // Python: from ... import / import ...
  /^(?:from|import)\s+([a-zA-Z0-9_.]+)/gm,
  // Rust: use crate::...
  /use\s+(?:crate|super|self)::([a-zA-Z0-9_:]+)/g,
];

// Extensions to try when resolving imports
const RESOLVE_EXTENSIONS = [
  "", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  "/index.ts", "/index.tsx", "/index.js", "/index.jsx",
];

/**
 * Extract import paths from file content.
 */
export function extractImports(content: string, filePath: string): string[] {
  const imports: string[] = [];
  const seen = new Set<string>();

  for (const pattern of IMPORT_PATTERNS) {
    // Reset the global regex
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const raw = match[1];
      if (raw && !seen.has(raw)) {
        seen.add(raw);
        // Only include relative imports (skip node_modules/packages)
        if (raw.startsWith(".") || raw.startsWith("/")) {
          imports.push(raw);
        }
      }
    }
  }

  return imports;
}

/**
 * Resolve a relative import path to an absolute file path.
 */
function resolveImportPath(
  importPath: string,
  fromFile: string,
  existingFiles: Set<string>,
): string | null {
  // Get directory of the importing file
  const fromDir = fromFile.substring(0, fromFile.lastIndexOf("/"));
  let resolved: string;

  if (importPath.startsWith("/")) {
    resolved = importPath;
  } else {
    // Resolve relative path
    const parts = fromDir.split("/");
    const importParts = importPath.split("/");

    for (const part of importParts) {
      if (part === "..") {
        parts.pop();
      } else if (part !== ".") {
        parts.push(part);
      }
    }
    resolved = parts.join("/");
  }

  // Try different extensions
  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = resolved + ext;
    if (existingFiles.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Build a dependency graph starting from the given root files.
 *
 * @param rootPaths - File paths to start traversal from
 * @param ide - IDE interface for reading files and listing workspace contents
 * @param maxDepth - Maximum import chain depth to follow (default: 3)
 * @param maxNodes - Maximum total nodes in the graph (default: 50)
 * @returns The dependency subgraph
 */
export async function buildDependencyGraph(
  rootPaths: string[],
  ide: IDE,
  maxDepth: number = 3,
  maxNodes: number = 50,
): Promise<DependencyGraph> {
  const graph: DependencyGraph = {
    nodes: new Map(),
    roots: rootPaths,
  };

  // Collect workspace files for resolution
  const workspaceDirs = await ide.getWorkspaceDirs();
  const existingFiles = new Set<string>();

  // Helper to recursively list files
  async function listRecursive(dir: string, depth: number): Promise<void> {
    if (depth > 4) return; // Don't go too deep
    try {
      const entries = await ide.listDir(dir);
      for (const [name, fileType] of entries) {
        const fullPath = dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
        if (fileType === 1) { // FileType.File
          existingFiles.add(fullPath);
        } else if (fileType === 2 && !name.startsWith(".") && name !== "node_modules") { // FileType.Directory
          await listRecursive(fullPath, depth + 1);
        }
      }
    } catch {
      // Skip directories that can't be listed
    }
  }

  for (const dir of workspaceDirs) {
    await listRecursive(dir, 0);
  }

  // BFS traversal
  const queue: Array<{ path: string; depth: number }> = rootPaths.map((p) => ({
    path: p,
    depth: 0,
  }));

  while (queue.length > 0 && graph.nodes.size < maxNodes) {
    const { path, depth } = queue.shift()!;

    if (graph.nodes.has(path)) continue;
    if (depth > maxDepth) continue;

    let content: string;
    try {
      content = await ide.readFile(path);
    } catch {
      continue; // Can't read file
    }

    const importPaths = extractImports(content, path);
    const resolvedImports: string[] = [];

    for (const imp of importPaths) {
      const resolved = resolveImportPath(imp, path, existingFiles);
      if (resolved) {
        resolvedImports.push(resolved);
      }
    }

    const node: DependencyNode = {
      path,
      imports: resolvedImports,
      importedBy: [],
      depth,
    };

    graph.nodes.set(path, node);

    // Enqueue resolved imports for further traversal
    for (const imp of resolvedImports) {
      if (!graph.nodes.has(imp) && depth + 1 <= maxDepth) {
        queue.push({ path: imp, depth: depth + 1 });
      }
    }
  }

  // Build reverse edges (importedBy)
  for (const [path, node] of graph.nodes) {
    for (const imp of node.imports) {
      const importedNode = graph.nodes.get(imp);
      if (importedNode) {
        importedNode.importedBy.push(path);
      }
    }
  }

  return graph;
}

/**
 * Get all files within N import hops of the root files.
 */
export function getFilesWithinDistance(
  graph: DependencyGraph,
  maxDistance: number,
): string[] {
  return Array.from(graph.nodes.values())
    .filter((node) => node.depth <= maxDistance)
    .map((node) => node.path);
}

/**
 * Get the direct dependencies of a file.
 */
export function getDirectDependencies(
  graph: DependencyGraph,
  filePath: string,
): string[] {
  const node = graph.nodes.get(filePath);
  return node ? node.imports : [];
}

/**
 * Get files that depend on the given file.
 */
export function getDependents(
  graph: DependencyGraph,
  filePath: string,
): string[] {
  const node = graph.nodes.get(filePath);
  return node ? node.importedBy : [];
}
