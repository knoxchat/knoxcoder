/** Minimal `vscode` stand-in for host unit tests that run without an editor. */
export const workspace = {
  workspaceFolders: undefined as undefined | Array<{ uri: { fsPath: string } }>,
  getConfiguration: () => ({ get: (_k: string, d?: unknown) => d }),
  onDidChangeConfiguration: () => ({ dispose() {} }),
};
export const window = {};
export const Uri = { file: (p: string) => ({ fsPath: p, scheme: "file" }) };
export class EventEmitter {
  event = () => ({ dispose() {} });
  fire() {}
  dispose() {}
}
export default { workspace, window, Uri, EventEmitter };
