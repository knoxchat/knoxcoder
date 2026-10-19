/**
 * K-084: product tools take narrow ports, not a full IDE.
 * Callers that only have `IDE` omit the ports; these helpers fall back to it.
 * Diagnostics, DAP, checkpoints, secrets, and LSP stay on `IDE`.
 * A messenger-only Core is still stretch (Core still takes `IDE` for those).
 */

import type {
  IDE,
  ToolEditor,
  ToolExtras,
  ToolFilesystem,
  ToolGit,
  ToolSearch,
  ToolSubprocess,
  ToolTerminal,
} from "..";

export type {
  ToolEditor,
  ToolFilesystem,
  ToolGit,
  ToolSearch,
  ToolSubprocess,
  ToolTerminal,
};

/** Fill every K-084 port from an IDE (worktree/staging wrappers included). */
export function withIdePorts(ide: IDE): {
  ide: IDE;
  fs: ToolFilesystem;
  proc: ToolSubprocess;
  search: ToolSearch;
  git: ToolGit;
  term: ToolTerminal;
  editor: ToolEditor;
} {
  return {
    ide,
    fs: ide,
    proc: ide,
    search: ide,
    git: ide,
    term: ide,
    editor: ide,
  };
}

export function toolFilesystem(extras: ToolExtras): ToolFilesystem {
  return extras.fs ?? extras.ide;
}

export function toolSubprocess(extras: ToolExtras): ToolSubprocess {
  return extras.proc ?? extras.ide;
}

export function toolSearch(extras: ToolExtras): ToolSearch {
  return extras.search ?? extras.ide;
}

export function toolGit(extras: ToolExtras): ToolGit {
  return extras.git ?? extras.ide;
}

export function toolTerminal(extras: ToolExtras): ToolTerminal {
  return extras.term ?? extras.ide;
}

export function toolEditor(extras: ToolExtras): ToolEditor {
  return extras.editor ?? extras.ide;
}
