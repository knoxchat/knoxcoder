/** Minimal `vscode` stand-in for host unit tests that run without an editor. */
export const ProgressLocation = { SourceControl: 1, Window: 2, Notification: 15 };

export const workspace = {
  workspaceFolders: undefined as undefined | Array<{ uri: { fsPath: string }; name?: string }>,
  textDocuments: [] as Array<{ uri: { scheme: string; fsPath: string }; isDirty: boolean }>,
  getConfiguration: () => ({ get: (_k: string, d?: unknown) => d }),
  onDidChangeConfiguration: () => ({ dispose() {} }),
};

export const window = {
  withProgress: async (
    _opts: unknown,
    task: (
      progress: { report: (value: unknown) => void },
      token: { isCancellationRequested: boolean },
    ) => unknown,
  ) => {
    return task({ report() {} }, { isCancellationRequested: false });
  },
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
};

export const Uri = { file: (p: string) => ({ fsPath: p, scheme: "file" }) };

export class EventEmitter {
  event = () => ({ dispose() {} });
  fire() {}
  dispose() {}
}

export default { workspace, window, Uri, EventEmitter, ProgressLocation };
