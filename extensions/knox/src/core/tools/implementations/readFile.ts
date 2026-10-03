import { resolveRelativePathInDir } from "../../util/ideUtils";
import { noteFileContent } from "./editFile";
import { t } from "../../i18n/index.js";
import { getUriPathBasename } from "../../util/uri";
import { detectLanguageFromExtension } from "../templates/fileTemplates";

import { capLines, DEFAULT_MAX_OUTPUT_LINES } from "../truncateOutput";

import { ToolImpl } from ".";

export const DEFAULT_READ_MAX_BYTES = 100_000;
export const READ_HEAD_TAIL_LINES = 40;

const BINARY_BASENAMES = new Set([
  "vmlinux",
  "vmlinux.bin",
  "vmlinux.o",
  "vmlinux.elf",
  "image",
  "zimage",
  "bzimage",
]);

const BINARY_EXTENSIONS = new Set([
  "o",
  "ko",
  "a",
  "so",
  "dylib",
  "dll",
  "elf",
  "dtb",
  "exe",
  "wasm",
]);

function pathBasename(filepath: string): string {
  const cleaned = filepath.split("?")[0].replace(/\\/g, "/");
  return cleaned.split("/").pop() ?? cleaned;
}

export function isRefusedBinaryPath(filepath: string): boolean {
  const base = pathBasename(filepath).toLowerCase();
  if (BINARY_BASENAMES.has(base)) {
    return true;
  }
  const dot = base.lastIndexOf(".");
  if (dot < 0) {
    return false;
  }
  return BINARY_EXTENSIONS.has(base.slice(dot + 1));
}

export function looksLikeBinaryContent(content: string): boolean {
  if (content.startsWith("\u007fELF")) {
    return true;
  }
  const probe = content.slice(0, 256);
  return probe.includes("\0");
}

export function formatTruncatedFileRead(opts: {
  lines: string[];
  totalLines: number;
  sizeInBytes: number;
  maxBytes: number;
  startLine?: number;
  endLine?: number;
}): string {
  const { lines, totalLines, sizeInBytes, maxBytes, startLine, endLine } = opts;
  const head = READ_HEAD_TAIL_LINES;
  const tail = READ_HEAD_TAIL_LINES;
  const rangeNote =
    startLine !== undefined || endLine !== undefined
      ? `Requested range: lines ${startLine ?? 1}-${endLine ?? totalLines}. `
      : "";
  const meta =
    `${rangeNote}File has ${totalLines} lines (${formatBytes(sizeInBytes)}); ` +
    `truncated at ${formatBytes(maxBytes)}. Pass startLine/endLine to read a range.`;

  if (lines.length <= head + tail) {
    return `${meta}\n\n${lines.join("\n")}`;
  }
  const omitted = lines.length - head - tail;
  return [
    meta,
    "",
    ...lines.slice(0, head),
    `\n… truncated ${omitted} middle lines. Use startLine/endLine for a range.\n`,
    ...lines.slice(-tail),
  ].join("\n");
}

/** Parse a line-number argument (number or numeric string); ignores empty/NaN values. */
function parseLineArg(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const n = typeof value === "number" ? Math.trunc(value) : parseInt(String(value), 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Enhanced Read File Implementation
 * 
 * Features:
 * - Line range reading for partial file content
 * - File metadata extraction (size, lines, language)
 * - Line numbering for reference
 * - Encoding support
 * - Syntax/language detection
 * - Size limiting for large files
 * - Comprehensive error handling
 * - Smart content preview with truncation
 */
export const readFileImpl: ToolImpl = async (args, extras) => {
  // Validate required arguments
  if (!args.filepath || typeof args.filepath !== 'string') {
    throw new Error(t("missingRequiredParam", { param: "filepath" }));
  }

  const filepath = args.filepath.trim();
  
  if (!filepath) {
    throw new Error(t("filepathCannotBeEmpty"));
  }

  if (isRefusedBinaryPath(filepath)) {
    return [
      {
        name: getUriPathBasename(filepath),
        description: filepath,
        content:
          `Refused to read binary/generated artifact ${filepath} (*.o, *.ko, vmlinux, ELF). ` +
          `Use readelf/objdump, builtin_build logs, or a hex dump — not this tool.`,
      },
    ];
  }

  // Resolve the file URI
  let resolvedFileUri: string | undefined;
  try {
    resolvedFileUri = await resolveRelativePathInDir(
      filepath,
      extras.ide,
    );
    if (!resolvedFileUri) {
      throw new Error(
        `${t("couldNotFindFile", { filepath })} Use a workspace-relative path (e.g. src/main.rs). A leading workspace folder name is optional.`,
      );
    }
  } catch (error) {
    throw new Error(t("failedToResolveFilePath", { filepath, error: (error as Error).message }));
  }

  // Check if file exists
  const fileExists = await extras.ide.fileExists(resolvedFileUri);
  if (!fileExists) {
    throw new Error(
      t("fileDoesNotExist", { filepath })
    );
  }

  // Parse optional parameters
  let startLine = parseLineArg(args.startLine);
  let endLine = parseLineArg(args.endLine);
  const includeMetadata = args.includeMetadata === true;
  const includeLineNumbers = args.includeLineNumbers === true;
  const showSyntaxInfo = args.showSyntaxInfo === true;
  const maxBytes = args.maxBytes ? parseInt(args.maxBytes) : DEFAULT_READ_MAX_BYTES;

  // Validate line numbers if provided
  if (startLine !== undefined && startLine < 1) {
    throw new Error(t("startLineMustBeGte1"));
  }
  if (endLine !== undefined && endLine < 1) {
    throw new Error(t("endLineMustBeGte1"));
  }
  // Models occasionally send a reversed range (e.g. startLine=120, endLine=80).
  // The intent is unambiguous, so swap the bounds instead of failing the call.
  let rangeNote = "";
  if (startLine !== undefined && endLine !== undefined && startLine > endLine) {
    rangeNote = `Note: startLine (${startLine}) was greater than endLine (${endLine}); the range was swapped to lines ${endLine}-${startLine}.\n\n`;
    [startLine, endLine] = [endLine, startLine];
  }

  // Read file content
  let content: string;
  try {
    if (startLine !== undefined || endLine !== undefined) {
      // Use readRangeInFile if line range is specified
      const range = {
        start: { line: (startLine || 1) - 1, character: 0 },
        end: { line: (endLine || 999999) - 1, character: 999999 }
      };
      content = await extras.ide.readRangeInFile(resolvedFileUri, range);
    } else {
      // Read entire file
      content = await extras.ide.readFile(resolvedFileUri);
      noteFileContent(resolvedFileUri, content);
    }
  } catch (error) {
    throw new Error(t("failedToReadFile", { filepath, error: (error as Error).message }));
  }

  // Handle empty content
  if (!content) {
    content = ''; // Ensure content is a string
  }

  // Apply line numbering if requested
  let processedContent = content;
  if (includeLineNumbers) {
    const lines = content.split('\n');
    const lineNumberWidth = Math.max(3, String(lines.length + (startLine || 1) - 1).length);
    processedContent = lines.map((line, idx) => {
      const lineNum = (startLine || 1) + idx;
      return `${String(lineNum).padStart(lineNumberWidth)} | ${line}`;
    }).join('\n');
  }

  // Detect language/syntax
  const language = detectLanguageFromExtension(filepath);
  
  // Calculate metadata
  const lines = content.split('\n');
  const totalLines = lines.length;
  const sizeInBytes = Buffer.from(content, 'utf-8').length;
  const basename = getUriPathBasename(filepath);

  // Get file stats if metadata is requested
  let fileStats: any = null;
  if (includeMetadata) {
    try {
      const statsMap = await extras.ide.getFileStats([resolvedFileUri]);
      fileStats = statsMap[resolvedFileUri];
    } catch (error) {
      // Stats are optional, continue without them
      console.warn(t("couldNotRetrieveFileStats", { filepath }));
    }
  }

  // Build description
  let description = filepath;
  if (startLine !== undefined || endLine !== undefined) {
    const start = startLine || 1;
    const end = endLine || totalLines;
    description = `${filepath} (lines ${start}-${end})`;
  }

  // Build metadata section
  let metadataSection = '';
  if (includeMetadata || showSyntaxInfo) {
    const metadataParts: string[] = [];
    
    if (includeMetadata) {
      metadataParts.push(`📄 File: ${filepath}`);
      metadataParts.push(`📏 Size: ${formatBytes(sizeInBytes)}`);
      metadataParts.push(`📝 Lines: ${totalLines}`);
      
      if (fileStats) {
        metadataParts.push(`🕐 Last Modified: ${new Date(fileStats.lastModified).toLocaleString()}`);
      }
    }
    
    if (showSyntaxInfo && language) {
      metadataParts.push(`💻 Language: ${language}`);
    }
    
    if (startLine !== undefined || endLine !== undefined) {
      const start = startLine || 1;
      const end = endLine || totalLines;
      metadataParts.push(`📍 Range: Lines ${start} to ${end}`);
    }
    
    if (metadataParts.length > 0) {
      metadataSection = '## File Metadata\n' + metadataParts.join('\n') + '\n\n---\n\n';
    }
  }

  if (looksLikeBinaryContent(content)) {
    return [
      {
        name: basename,
        description: filepath,
        content:
          `Refused to read ${filepath}: content looks like a binary (ELF or NUL bytes). ` +
          `Use readelf/objdump instead of builtin_read_file.`,
        uri: {
          type: "file",
          value: resolvedFileUri,
        },
      },
    ];
  }

  // Build final content with metadata
  let finalContent = processedContent;
  
  const isTruncated = sizeInBytes > maxBytes;
  if (isTruncated) {
    finalContent = formatTruncatedFileRead({
      lines: processedContent.split("\n"),
      totalLines,
      sizeInBytes,
      maxBytes,
      startLine,
      endLine,
    });
  }

  // Default line cap with continuation hint (K-033).
  if (!isTruncated) {
    const firstLine = startLine ?? 1;
    const capped = capLines(finalContent, {
      maxLines: DEFAULT_MAX_OUTPUT_LINES,
      firstLine,
      hint: (next) =>
        `… ${totalLines - DEFAULT_MAX_OUTPUT_LINES} more lines (file/range has ${totalLines}). Continue with startLine=${next}.`,
    });
    finalContent = capped.text;
  }

  // Combine metadata and content
  const responseContent = rangeNote + metadataSection + finalContent;

  // Build context item name
  let contextName = basename;
  if (startLine !== undefined || endLine !== undefined) {
    contextName = `${basename} (lines ${startLine || 1}-${endLine || totalLines})`;
  }

  // Return enhanced context item
  return [
    {
      name: contextName,
      description: description,
      content: responseContent,
      uri: {
        type: "file",
        value: resolvedFileUri,
      },
    },
  ];
};

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}
