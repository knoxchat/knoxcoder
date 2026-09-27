/**
 * KN-210: frozen IDE façade catalog.
 *
 * `IDE` in `index.d.ts` is the type. This file is the checklist: every method
 * is either required (host must implement) or optional (headless IDEs may omit;
 * VsCodeIde still implements them). Keep the three in sync — the contract test
 * fails on drift.
 */

/** Host must implement these. Core tools and context providers call them. */
export const IDE_REQUIRED_METHODS = [
	"getIdeInfo",
	"getIdeSettings",
	"getDiff",
	"getGitChangedFiles",
	"getClipboardContent",
	"getUniqueId",
	"getTerminalContents",
	"getDebugLocals",
	"getTopLevelCallStackSources",
	"getAvailableThreads",
	"getWorkspaceDirs",
	"fileExists",
	"writeFile",
	"showVirtualFile",
	"openFile",
	"openUrl",
	"runCommand",
	"saveFile",
	"readFile",
	"readRangeInFile",
	"showLines",
	"getOpenFiles",
	"getCurrentFile",
	"getPinnedFiles",
	"getSearchResults",
	"subprocess",
	"getProblems",
	"getBranch",
	"getRepoName",
	"showToast",
	"getGitRootPath",
	"listDir",
	"getFileStats",
	"readSecrets",
	"writeSecrets",
	"gotoDefinition",
	"findReferences",
	"getHover",
	"getDocumentSymbols",
	"getWorkspaceSymbols",
	"gotoImplementation",
	"prepareCallHierarchy",
	"getIncomingCalls",
	"getOutgoingCalls",
	"getTags",
	"onDidChangeActiveTextEditor",
] as const;

/**
 * Optional on headless IDEs. VsCodeIde implements all of these.
 * Core must call them with `ide.foo?.(...)` or a runtime check.
 */
export const IDE_OPTIONAL_METHODS = [
	"getGitStatusPorcelain",
	"getGitDiffCached",
	"debugControl",
	"removeFile",
	"getLastFileSaveTimestamp",
	"updateLastFileSaveTimestamp",
	"runPostEditVerification",
	"runPreRiskyCheckpoint",
	"ensureTurnCheckpoint",
	"listWorkspaceCheckpoints",
	"createWorkspaceCheckpoint",
	"restoreWorkspaceCheckpoint",
	"previewWorkspaceCheckpointRestore",
	"diffWorkspaceCheckpoint",
	"deleteWorkspaceCheckpoint",
	"pinWorkspaceCheckpoint",
	"captureMutatingToolBefore",
	"recordMutatingToolAfter",
] as const;

export type IdeRequiredMethod = (typeof IDE_REQUIRED_METHODS)[number];
export type IdeOptionalMethod = (typeof IDE_OPTIONAL_METHODS)[number];

export const IDE_ALL_METHODS = [
	...IDE_REQUIRED_METHODS,
	...IDE_OPTIONAL_METHODS,
] as const;
