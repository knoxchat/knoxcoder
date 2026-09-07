import {
  inferResolvedUriFromRelativePath,
  resolveRelativePathInDir,
} from "core/util/ideUtils";

import type { IIdeMessenger } from "../context/IdeMessenger";

export interface OpenFileInEditorOptions {
  /** 1-based line number as shown in the UI (ripgrep, code snippet gutters). */
  startLine?: number;
  /** 1-based inclusive end line. Defaults to startLine. */
  endLine?: number;
}

export function splitDisplayPath(filepath: string): {
  dir: string;
  name: string;
} {
  const clean = filepath.replace(/\\/g, "/").replace(/^\.\//, "");
  const lastSlash = clean.lastIndexOf("/");
  if (lastSlash === -1) {
    return { dir: "", name: clean };
  }
  return {
    dir: clean.slice(0, lastSlash + 1),
    name: clean.slice(lastSlash + 1),
  };
}

/**
 * Resolve a workspace-relative, absolute, or URI path and open it in the editor.
 * When line numbers are provided they are treated as 1-based display lines.
 */
export async function openFileInEditor(
  ideMessenger: IIdeMessenger,
  filepath: string,
  options?: OpenFileInEditorOptions,
): Promise<void> {
  const trimmed = filepath?.trim();
  if (!trimmed) {
    return;
  }

  try {
    const alreadyUri = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
    const uri = alreadyUri
      ? trimmed
      : ((await resolveRelativePathInDir(trimmed, ideMessenger.ide)) ??
        (await inferResolvedUriFromRelativePath(trimmed, ideMessenger.ide)));

    if (options?.startLine != null && options.startLine > 0) {
      const startLine = options.startLine - 1;
      const endLine =
        options.endLine != null && options.endLine > 0
          ? options.endLine - 1
          : startLine;
      ideMessenger.post("showLines", {
        filepath: uri,
        startLine,
        endLine,
      });
      return;
    }

    ideMessenger.post("showFile", { filepath: uri });
  } catch (e) {
    console.warn("[openFileInEditor] failed to open", trimmed, e);
  }
}
