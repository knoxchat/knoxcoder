/**
 * Enhanced View Subdirectory Implementation
 * 
 * A powerful directory viewing tool with filtering, statistics, git integration,
 * and comprehensive analysis capabilities.
 */

import { resolveRelativePathInDir } from "../../util/ideUtils";
import { t } from "../../i18n/index.js";
import {
  addNestedWalkIgnore,
  loadWalkIgnore,
  type WalkIgnoreMatcher,
} from "../../util/walkIgnore";

import { DEFAULT_VIEW_SUBDIRECTORY_MAX_FILES } from "../builtIn";

import { ToolImpl } from ".";

// FileType enum values (from index.d.ts - not available at runtime)
const FILE_TYPE_FILE = 1;
const FILE_TYPE_DIRECTORY = 2;

// Simple glob pattern matching implementation
function simpleGlobMatch(str: string, pattern: string): boolean {
  // Escape special regex chars except * and ?
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  
  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(str);
}

// Default patterns to exclude
const DEFAULT_EXCLUDE_PATTERNS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "__pycache__",
  ".venv",
  "venv",
  ".pytest_cache",
  ".mypy_cache",
  "target",
  ".DS_Store",
  "*.pyc",
  "*.pyo",
  "*.class",
  "*.o",
  "*.obj",
];

// File type categories for analysis
const FILE_TYPE_CATEGORIES: Record<string, string[]> = {
  "TypeScript": ["ts", "tsx", "mts", "cts"],
  "JavaScript": ["js", "jsx", "mjs", "cjs"],
  "Python": ["py", "pyi", "pyw"],
  "Rust": ["rs"],
  "Go": ["go"],
  "Java": ["java"],
  "C/C++": ["c", "cpp", "cc", "cxx", "h", "hpp", "hxx"],
  "C#": ["cs"],
  "Ruby": ["rb", "rake"],
  "PHP": ["php"],
  "Swift": ["swift"],
  "Kotlin": ["kt", "kts"],
  "Markdown": ["md", "mdx"],
  "JSON": ["json", "jsonc"],
  "YAML": ["yml", "yaml"],
  "TOML": ["toml"],
  "HTML": ["html", "htm"],
  "CSS": ["css", "scss", "sass", "less"],
  "SQL": ["sql"],
  "Shell": ["sh", "bash", "zsh", "fish"],
  "Config": ["config", "conf", "cfg", "ini", "env"],
};

interface FileInfo {
  name: string;
  relativePath: string;
  fullPath: string;
  isDirectory: boolean;
  extension?: string;
  size?: number;
  lineCount?: number;
  lastModified?: number;
  gitStatus?: string;
  depth: number;
}

interface DirectoryStats {
  totalFiles: number;
  totalDirectories: number;
  totalSize: number;
  filesByType: Record<string, number>;
  filesByCategory: Record<string, number>;
  largestFiles: { path: string; size: number }[];
  recentlyModified: { path: string; modified: number }[];
  averageFileSize: number;
  maxDepth: number;
}

interface ViewSubdirectoryArgs {
  directory_path: string;
  depth?: number;
  fileTypes?: string[];
  pattern?: string;
  excludePatterns?: string[];
  includeHidden?: boolean;
  includeStats?: boolean;
  includeGitStatus?: boolean;
  sortBy?: "name" | "size" | "modified" | "type";
  maxFiles?: number;
  showSummary?: boolean;
  outputFormat?: "tree" | "flat" | "detailed";
}

/**
 * Get the file extension from a filename
 */
function getExtension(filename: string): string | undefined {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1 || lastDot === 0) return undefined;
  return filename.slice(lastDot + 1).toLowerCase();
}

/**
 * Get the category for a file extension
 */
function getFileCategory(extension: string | undefined): string {
  if (!extension) return "Other";
  for (const [category, extensions] of Object.entries(FILE_TYPE_CATEGORIES)) {
    if (extensions.includes(extension.toLowerCase())) {
      return category;
    }
  }
  return "Other";
}

/**
 * Check if a path matches any of the exclude patterns
 */
function matchesExcludePattern(relativePath: string, patterns: string[]): boolean {
  const pathParts = relativePath.split("/");
  return patterns.some(pattern => {
    // Check if any path segment matches the pattern
    return pathParts.some(part => simpleGlobMatch(part, pattern)) ||
           simpleGlobMatch(relativePath, pattern) ||
           simpleGlobMatch(relativePath, `**/${pattern}`);
  });
}

/**
 * Check if a file matches the include patterns
 */
function matchesIncludePattern(
  filename: string, 
  relativePath: string, 
  fileTypes?: string[], 
  pattern?: string
): boolean {
  // If no filters, include everything
  if (!fileTypes?.length && !pattern) return true;
  
  // Check file type filter
  if (fileTypes?.length) {
    const ext = getExtension(filename);
    if (!ext || !fileTypes.includes(ext)) {
      return false;
    }
  }
  
  // Check glob pattern
  if (pattern) {
    if (!simpleGlobMatch(filename, pattern) && 
        !simpleGlobMatch(relativePath, pattern)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Format file size for display
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  if (diff < 60 * 1000) return "just now";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))} min ago`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))} hours ago`;
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / (24 * 60 * 60 * 1000))} days ago`;
  
  return date.toLocaleDateString();
}

/**
 * Git status symbols
 */
const GIT_STATUS_SYMBOLS: Record<string, string> = {
  "modified": "M",
  "added": "A",
  "deleted": "D",
  "renamed": "R",
  "untracked": "?",
  "staged": "S",
  "conflict": "C",
};

/**
 * Recursively walk a directory and collect file information
 */
async function walkDirectory(
  dirPath: string,
  basePath: string,
  ide: any,
  args: ViewSubdirectoryArgs,
  currentDepth: number = 0,
  collectedFiles: FileInfo[] = [],
  matcher?: WalkIgnoreMatcher,
): Promise<FileInfo[]> {
  const maxDepth = args.depth ?? -1;
  const excludePatterns = args.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS;
  const includeHidden = args.includeHidden ?? false;
  const maxFiles = args.maxFiles ?? DEFAULT_VIEW_SUBDIRECTORY_MAX_FILES;
  
  // Check depth limit
  if (maxDepth !== -1 && currentDepth > maxDepth) {
    return collectedFiles;
  }
  
  // Check file limit
  if (collectedFiles.length >= maxFiles) {
    return collectedFiles;
  }
  
  try {
    const entries = await ide.listDir(dirPath);

    if (matcher) {
      for (const [name, fileType] of entries) {
        if (fileType === FILE_TYPE_FILE) {
          await addNestedWalkIgnore(ide, dirPath, name, matcher);
        }
      }
    }
    
    for (const [name, fileType] of entries) {
      // Skip hidden files if not included
      if (!includeHidden && name.startsWith(".")) {
        continue;
      }
      
      const fullPath = `${dirPath}/${name}`;
      const relativePath = fullPath.replace(basePath + "/", "");
      const isDirectory = fileType === FILE_TYPE_DIRECTORY;
      if (matcher?.ignores(fullPath, isDirectory)) {
        continue;
      }
      
      // Check exclude patterns
      if (matchesExcludePattern(relativePath, excludePatterns)) {
        continue;
      }
      
      // For files, check if they match include filters
      if (!isDirectory) {
        if (!matchesIncludePattern(name, relativePath, args.fileTypes, args.pattern)) {
          continue;
        }
      }
      
      const fileInfo: FileInfo = {
        name,
        relativePath,
        fullPath,
        isDirectory,
        extension: isDirectory ? undefined : getExtension(name),
        depth: currentDepth,
      };
      
      collectedFiles.push(fileInfo);
      
      // Recursively process directories
      if (isDirectory && collectedFiles.length < maxFiles) {
        await walkDirectory(
          fullPath,
          basePath,
          ide,
          args,
          currentDepth + 1,
          collectedFiles,
          matcher,
        );
      }
    }
  } catch (error) {
    // Silently skip directories we can't read
    console.warn(t("couldNotReadDirectory", { path: dirPath }), error);
  }
  
  return collectedFiles;
}

/**
 * Get file statistics for a list of files
 */
async function getFileStatistics(
  files: FileInfo[], 
  ide: any
): Promise<Map<string, { size: number; lastModified: number }>> {
  const stats = new Map<string, { size: number; lastModified: number }>();
  
  // Get stats in batches to avoid overwhelming the IDE
  const filePaths = files.filter(f => !f.isDirectory).map(f => f.fullPath);
  
  try {
    const fileStats = await ide.getFileStats(filePaths);
    for (const [path, stat] of Object.entries(fileStats)) {
      stats.set(path, stat as { size: number; lastModified: number });
    }
  } catch (error) {
    console.warn(t("couldNotGetFileStats"), error);
  }
  
  return stats;
}

/**
 * Get git status for files in a directory
 */
async function getGitStatus(
  basePath: string, 
  files: FileInfo[], 
  ide: any
): Promise<Map<string, string>> {
  const gitStatus = new Map<string, string>();
  
  try {
    // Check if this is a git repository
    const gitRoot = await ide.getGitRootPath(basePath);
    if (!gitRoot) {
      return gitStatus;
    }
    
    // Get git diff for modified/staged files
    const diffs = await ide.getDiff(true);
    
    // Parse diff output to extract file statuses
    for (const diff of diffs) {
      // Extract filename from diff header
      const match = diff.match(/diff --git a\/(.+?) b\//);
      if (match) {
        const filePath = match[1];
        // Determine status based on diff content
        if (diff.includes("new file")) {
          gitStatus.set(filePath, "added");
        } else if (diff.includes("deleted file")) {
          gitStatus.set(filePath, "deleted");
        } else {
          gitStatus.set(filePath, "modified");
        }
      }
    }
  } catch (error) {
    console.warn(t("couldNotGetGitStatus"), error);
  }
  
  return gitStatus;
}

/**
 * Calculate directory statistics
 */
function calculateStats(files: FileInfo[]): DirectoryStats {
  const stats: DirectoryStats = {
    totalFiles: 0,
    totalDirectories: 0,
    totalSize: 0,
    filesByType: {},
    filesByCategory: {},
    largestFiles: [],
    recentlyModified: [],
    averageFileSize: 0,
    maxDepth: 0,
  };
  
  const fileSizes: { path: string; size: number }[] = [];
  const fileModified: { path: string; modified: number }[] = [];
  
  for (const file of files) {
    if (file.isDirectory) {
      stats.totalDirectories++;
    } else {
      stats.totalFiles++;
      
      // Track by extension
      const ext = file.extension || "no extension";
      stats.filesByType[ext] = (stats.filesByType[ext] || 0) + 1;
      
      // Track by category
      const category = getFileCategory(file.extension);
      stats.filesByCategory[category] = (stats.filesByCategory[category] || 0) + 1;
      
      // Track size
      if (file.size !== undefined) {
        stats.totalSize += file.size;
        fileSizes.push({ path: file.relativePath, size: file.size });
      }
      
      // Track modified time
      if (file.lastModified !== undefined) {
        fileModified.push({ path: file.relativePath, modified: file.lastModified });
      }
    }
    
    // Track max depth
    if (file.depth > stats.maxDepth) {
      stats.maxDepth = file.depth;
    }
  }
  
  // Calculate average
  if (stats.totalFiles > 0 && stats.totalSize > 0) {
    stats.averageFileSize = Math.round(stats.totalSize / stats.totalFiles);
  }
  
  // Get top 5 largest files
  stats.largestFiles = fileSizes
    .sort((a, b) => b.size - a.size)
    .slice(0, 5);
  
  // Get top 5 recently modified files
  stats.recentlyModified = fileModified
    .sort((a, b) => b.modified - a.modified)
    .slice(0, 5);
  
  return stats;
}

/**
 * Sort files based on the specified criteria
 */
function sortFiles(files: FileInfo[], sortBy: string): FileInfo[] {
  const sorted = [...files];
  
  switch (sortBy) {
    case "size":
      sorted.sort((a, b) => (b.size || 0) - (a.size || 0));
      break;
    case "modified":
      sorted.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
      break;
    case "type":
      sorted.sort((a, b) => {
        const extA = a.extension || "";
        const extB = b.extension || "";
        if (extA === extB) return a.name.localeCompare(b.name);
        return extA.localeCompare(extB);
      });
      break;
    case "name":
    default:
      // Sort directories first, then by name
      sorted.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
      break;
  }
  
  return sorted;
}

/**
 * Build a tree structure from flat file list
 */
interface TreeNode {
  name: string;
  isDirectory: boolean;
  file?: FileInfo;
  children: Map<string, TreeNode>;
}

function buildTree(files: FileInfo[]): TreeNode {
  const root: TreeNode = {
    name: "",
    isDirectory: true,
    children: new Map(),
  };
  
  for (const file of files) {
    const parts = file.relativePath.split("/");
    let current = root;
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          isDirectory: isLast ? file.isDirectory : true,
          file: isLast ? file : undefined,
          children: new Map(),
        });
      }
      
      current = current.children.get(part)!;
    }
  }
  
  return root;
}

/**
 * Render tree structure as string
 */
function renderTree(
  node: TreeNode, 
  prefix: string = "", 
  isLast: boolean = true,
  includeStats: boolean = false
): string {
  let result = "";
  
  // Sort children: directories first, then alphabetically
  const sortedChildren = Array.from(node.children.entries()).sort((a, b) => {
    const [, nodeA] = a;
    const [, nodeB] = b;
    if (nodeA.isDirectory && !nodeB.isDirectory) return -1;
    if (!nodeA.isDirectory && nodeB.isDirectory) return 1;
    return nodeA.name.localeCompare(nodeB.name);
  });
  
  for (let i = 0; i < sortedChildren.length; i++) {
    const [name, child] = sortedChildren[i];
    const isLastChild = i === sortedChildren.length - 1;
    const connector = isLastChild ? "└── " : "├── ";
    const extension = isLastChild ? "    " : "│   ";
    
    // Build the line
    let line = prefix + connector + name;
    
    // Add trailing slash for directories
    if (child.isDirectory) {
      line += "/";
    }
    
    // Add stats if requested
    if (includeStats && child.file && !child.isDirectory) {
      const stats = [];
      if (child.file.size !== undefined) {
        stats.push(formatSize(child.file.size));
      }
      if (child.file.lastModified !== undefined) {
        stats.push(formatTimestamp(child.file.lastModified));
      }
      if (child.file.gitStatus) {
        stats.push(`[${GIT_STATUS_SYMBOLS[child.file.gitStatus] || child.file.gitStatus}]`);
      }
      if (stats.length > 0) {
        line += `  (${stats.join(", ")})`;
      }
    }
    
    result += line + "\n";
    
    // Recurse for directories
    if (child.isDirectory && child.children.size > 0) {
      result += renderTree(child, prefix + extension, isLastChild, includeStats);
    }
  }
  
  return result;
}

/**
 * Render flat file list
 */
function renderFlatList(files: FileInfo[], includeStats: boolean): string {
  const lines: string[] = [];
  
  for (const file of files) {
    let line = file.relativePath;
    if (file.isDirectory) line += "/";
    
    if (includeStats && !file.isDirectory) {
      const stats = [];
      if (file.size !== undefined) {
        stats.push(formatSize(file.size));
      }
      if (file.lastModified !== undefined) {
        stats.push(formatTimestamp(file.lastModified));
      }
      if (file.gitStatus) {
        stats.push(`[${GIT_STATUS_SYMBOLS[file.gitStatus] || file.gitStatus}]`);
      }
      if (stats.length > 0) {
        line += `  (${stats.join(", ")})`;
      }
    }
    
    lines.push(line);
  }
  
  return lines.join("\n");
}

/**
 * Render detailed table format
 */
function renderDetailedTable(files: FileInfo[]): string {
  const headers = ["Name", "Type", "Size", "Modified", "Git"];
  const rows: string[][] = [];
  
  for (const file of files) {
    if (file.isDirectory) continue;
    
    rows.push([
      file.relativePath,
      file.extension || "-",
      file.size !== undefined ? formatSize(file.size) : "-",
      file.lastModified !== undefined ? formatTimestamp(file.lastModified) : "-",
      file.gitStatus ? GIT_STATUS_SYMBOLS[file.gitStatus] || file.gitStatus : "-",
    ]);
  }
  
  // Calculate column widths
  const widths = headers.map((h, i) => 
    Math.max(h.length, ...rows.map(r => r[i]?.length || 0))
  );
  
  // Build table
  let table = "";
  
  // Header
  table += headers.map((h, i) => h.padEnd(widths[i])).join(" │ ") + "\n";
  table += widths.map(w => "─".repeat(w)).join("─┼─") + "\n";
  
  // Rows
  for (const row of rows) {
    table += row.map((cell, i) => cell.padEnd(widths[i])).join(" │ ") + "\n";
  }
  
  return table;
}

/**
 * Generate summary section
 */
function generateSummary(stats: DirectoryStats, args: ViewSubdirectoryArgs): string {
  let summary = `
Directory Analysis Summary
══════════════════════════════════════

📁 Path: ${args.directory_path}
📊 Total Files: ${stats.totalFiles}
📂 Total Directories: ${stats.totalDirectories}
`;

  if (stats.totalSize > 0) {
    summary += `💾 Total Size: ${formatSize(stats.totalSize)}
📏 Average File Size: ${formatSize(stats.averageFileSize)}
`;
  }

  summary += `🔢 Max Depth: ${stats.maxDepth}

`;

  // File type distribution
  if (Object.keys(stats.filesByCategory).length > 0) {
    summary += "📈 Files by Category:\n";
    const sortedCategories = Object.entries(stats.filesByCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    for (const [category, count] of sortedCategories) {
      const percentage = ((count / stats.totalFiles) * 100).toFixed(1);
      const bar = "█".repeat(Math.ceil(parseFloat(percentage) / 5));
      summary += `   ${category.padEnd(12)} ${bar} ${count} (${percentage}%)\n`;
    }
    summary += "\n";
  }

  // File type breakdown
  if (Object.keys(stats.filesByType).length > 0) {
    summary += "📋 Top File Extensions:\n";
    const sortedTypes = Object.entries(stats.filesByType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    
    for (const [ext, count] of sortedTypes) {
      summary += `   .${ext}: ${count}\n`;
    }
    summary += "\n";
  }

  // Largest files
  if (stats.largestFiles.length > 0) {
    summary += "📦 Largest Files:\n";
    for (const file of stats.largestFiles) {
      summary += `   ${formatSize(file.size).padEnd(10)} ${file.path}\n`;
    }
    summary += "\n";
  }

  // Recently modified
  if (stats.recentlyModified.length > 0) {
    summary += "🕐 Recently Modified:\n";
    for (const file of stats.recentlyModified) {
      summary += `   ${formatTimestamp(file.modified).padEnd(15)} ${file.path}\n`;
    }
    summary += "\n";
  }

  // Filters applied
  const filters: string[] = [];
  if (args.fileTypes?.length) {
    filters.push(`File types: ${args.fileTypes.join(", ")}`);
  }
  if (args.pattern) {
    filters.push(`Pattern: ${args.pattern}`);
  }
  if (args.depth !== undefined && args.depth !== -1) {
    filters.push(`Max depth: ${args.depth}`);
  }
  if (args.includeHidden) {
    filters.push("Including hidden files");
  }
  
  if (filters.length > 0) {
    summary += `🔍 Filters Applied:\n   ${filters.join("\n   ")}\n`;
  }

  summary += "\n══════════════════════════════════════\n";
  
  return summary;
}

/**
 * Main implementation
 */
export const viewSubdirectoryImpl: ToolImpl = async (args: any, extras) => {
  const typedArgs = args as ViewSubdirectoryArgs;
  const { directory_path } = typedArgs;
  
  // Resolve directory URI
  const uri = await resolveRelativePathInDir(directory_path, extras.ide);

  if (!uri) {
    throw new Error(t("directoryPathNotExist", { path: directory_path }));
  }

  // Check if it's actually a directory
  try {
    const entries = await extras.ide.listDir(uri);
    if (!entries) {
      throw new Error(t("notDirectoryOrCantAccess", { path: directory_path }));
    }
  } catch (error) {
    throw new Error(t("cannotAccessDirectory", { path: directory_path, error: (error as Error).message }));
  }

  let matcher: WalkIgnoreMatcher | undefined;
  try {
    const roots = [uri];
    if (typeof extras.ide.getWorkspaceDirs === "function") {
      roots.push(...(await extras.ide.getWorkspaceDirs()));
    }
    matcher = await loadWalkIgnore(extras.ide, roots);
  } catch {
    matcher = undefined;
  }

  // Collect files
  const files = await walkDirectory(
    uri,
    uri,
    extras.ide,
    typedArgs,
    0,
    [],
    matcher,
  );
  
  // Add statistics if requested
  if (typedArgs.includeStats) {
    const fileStats = await getFileStatistics(files, extras.ide);
    for (const file of files) {
      const stat = fileStats.get(file.fullPath);
      if (stat) {
        file.size = stat.size;
        file.lastModified = stat.lastModified;
      }
    }
  }
  
  // Add git status if requested
  if (typedArgs.includeGitStatus) {
    const gitStatus = await getGitStatus(uri, files, extras.ide);
    for (const file of files) {
      const status = gitStatus.get(file.relativePath);
      if (status) {
        file.gitStatus = status;
      }
    }
  }
  
  // Sort files
  const sortedFiles = sortFiles(files, typedArgs.sortBy || "name");
  
  // Calculate statistics
  const stats = calculateStats(sortedFiles);
  
  // Generate output based on format
  const outputFormat = typedArgs.outputFormat || "tree";
  const showSummary = typedArgs.showSummary !== false;
  const includeStats = typedArgs.includeStats || false;
  
  let structure: string;
  
  switch (outputFormat) {
    case "flat":
      structure = renderFlatList(sortedFiles, includeStats);
      break;
    case "detailed":
      structure = renderDetailedTable(sortedFiles);
      break;
    case "tree":
    default:
      const tree = buildTree(sortedFiles);
      structure = directory_path + "/\n" + renderTree(tree, "", true, includeStats);
      break;
  }
  
  // Build result - type is inferred from ToolImpl return type
  const results: { name: string; description: string; content: string }[] = [];
  
  // Add summary if requested
  if (showSummary) {
    results.push({
      name: "Directory Summary",
      description: `Analysis of ${directory_path}`,
      content: generateSummary(stats, typedArgs),
    });
  }
  
  // Add structure
  results.push({
    name: "Directory Structure",
    description: `Structure of ${directory_path}`,
    content: structure,
  });
  
  // If there are too many files, add a truncation notice
  const maxFiles = typedArgs.maxFiles ?? DEFAULT_VIEW_SUBDIRECTORY_MAX_FILES;
  if (files.length >= maxFiles) {
    results.push({
      name: "Notice",
      description: "Output truncated",
      content: `⚠️ Output was truncated to ${maxFiles} files. Use more specific filters, pass a higher maxFiles argument, or raise "Directory listing max files" in Settings.`,
    });
  }
  
  return results;
};
