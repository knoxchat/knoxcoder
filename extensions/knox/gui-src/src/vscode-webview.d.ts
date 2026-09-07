/**
 * VS Code webview API types.
 * The extension injects `const vscode = acquireVsCodeApi()` before the GUI loads.
 */

interface WebviewApi<StateType = unknown> {
  postMessage(message: unknown): void;
  getState(): StateType | undefined;
  setState<T extends StateType | undefined>(newState: T): T;
}

declare function acquireVsCodeApi<StateType = unknown>(): WebviewApi<StateType>;

declare const vscode: WebviewApi | undefined;
