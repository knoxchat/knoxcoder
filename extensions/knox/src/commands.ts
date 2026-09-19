 
import * as os from "node:os";

import {
  ContextMenuConfig,
  RangeInFileWithContents,
} from "core";
import { ConfigHandler } from "core/config/ConfigHandler";
import { Core } from "core/core";
import * as vscode from "vscode";

import { t } from "./i18n";

import { VerticalDiffManager } from "./diff/vertical/manager";
import { KnoxGUIWebviewViewProvider } from "./KnoxGUIWebviewViewProvider";
import EditDecorationManager from "./quickEdit/EditDecorationManager";
import { QuickEdit, QuickEditShowParams } from "./quickEdit/QuickEditQuickPick";
import { VsCodeIde } from "./VsCodeIde";

import type { VsCodeWebviewProtocol } from "./webviewProtocol";

function addCodeToContextFromRange(
  range: vscode.Range,
  webviewProtocol: VsCodeWebviewProtocol,
  prompt?: string,
) {
  const document = vscode.window.activeTextEditor?.document;

  if (!document) {
    return;
  }

  const rangeInFileWithContents = {
    filepath: document.uri.toString(),
    contents: document.getText(range),
    range: {
      start: {
        line: range.start.line,
        character: range.start.character,
      },
      end: {
        line: range.end.line,
        character: range.end.character,
      },
    },
  };

  webviewProtocol?.request("highlightedCode", {
    rangeInFileWithContents,
    prompt,
    // Assume `true` since range selection is currently only used for quick actions/fixes
    shouldRun: true,
  });
}

function getRangeInFileWithContents(
  allowEmpty?: boolean,
  range?: vscode.Range,
): RangeInFileWithContents | null {
  const editor = vscode.window.activeTextEditor;

  if (editor) {
    const selection = editor.selection;
    const filepath = editor.document.uri.toString();

    if (range) {
      const contents = editor.document.getText(range);

      return {
        range: {
          start: {
            line: range.start.line,
            character: range.start.character,
          },
          end: {
            line: range.end.line,
            character: range.end.character,
          },
        },
        filepath,
        contents,
      };
    }

    if (selection.isEmpty && !allowEmpty) {
      return null;
    }

    let selectionRange = new vscode.Range(selection.start, selection.end);
    const document = editor.document;
    // Select the context from the beginning of the selection start line to the selection start position
    const beginningOfSelectionStartLine = selection.start.with(undefined, 0);
    const textBeforeSelectionStart = document.getText(
      new vscode.Range(beginningOfSelectionStartLine, selection.start),
    );
    // If there are only whitespace before the start of the selection, include the indentation
    if (textBeforeSelectionStart.trim().length === 0) {
      selectionRange = selectionRange.with({
        start: beginningOfSelectionStartLine,
      });
    }

    const contents = editor.document.getText(selectionRange);

    return {
      filepath,
      contents,
      range: {
        start: {
          line: selection.start.line,
          character: selection.start.character,
        },
        end: {
          line: selection.end.line,
          character: selection.end.character,
        },
      },
    };
  }

  return null;
}

async function addEntireFileToContext(
  uri: vscode.Uri,
  webviewProtocol: VsCodeWebviewProtocol | undefined,
) {
  // If a directory, add all files in the directory
  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.type === vscode.FileType.Directory) {
    const files = await vscode.workspace.fs.readDirectory(uri);
    for (const [filename, type] of files) {
      if (type === vscode.FileType.File) {
        addEntireFileToContext(
          vscode.Uri.joinPath(uri, filename),
          webviewProtocol,
        );
      }
    }
    return;
  }

  // Get the contents of the file
  const contents = (await vscode.workspace.fs.readFile(uri)).toString();
  const rangeInFileWithContents = {
    filepath: uri.toString(),
    contents: contents,
    range: {
      start: {
        line: 0,
        character: 0,
      },
      end: {
        line: contents.split(os.EOL).length - 1,
        character: 0,
      },
    },
  };

  webviewProtocol?.request("highlightedCode", {
    rangeInFileWithContents,
  });
}

function focusGUI() {
  vscode.commands.executeCommand("knoxchat.knoxGUIView.focus");
}

async function processDiff(
  action: "accept" | "reject",
  sidebar: KnoxGUIWebviewViewProvider,
  ide: VsCodeIde,
  verticalDiffManager: VerticalDiffManager,
  newFileUri?: string,
  streamId?: string,
) {
  let newOrCurrentUri = newFileUri;
  if (!newOrCurrentUri) {
    const currentFile = await ide.getCurrentFile();
    newOrCurrentUri = currentFile?.path;
  }
  if (!newOrCurrentUri) {
    console.warn(`No file provided or current file is not open when attempting to resolve diff`);
    console.warn(`No file provided or current file is not open when attempting to resolve diff`);
    return;
  }

  await ide.openFile(newOrCurrentUri);

  // Clear vertical diffs depending on action
  verticalDiffManager.clearForfileUri(newOrCurrentUri, action === "accept");

  void sidebar.webviewProtocol.request("setEditStatus", {
    status: "done",
  });

  if (streamId) {
    const fileContent = await ide.readFile(newOrCurrentUri);

    await sidebar.webviewProtocol.request("updateApplyState", {
      fileContent,
      filepath: newOrCurrentUri,
      streamId,
      status: "closed",
      numDiffs: 0,
    });
  }

  await sidebar.webviewProtocol.request("exitEditMode", undefined);

  // Save the file
  await ide.saveFile(newOrCurrentUri);
}

// Copy everything over from extension.ts
const getCommandsMap: (
  ide: VsCodeIde,
  extensionContext: vscode.ExtensionContext,
  sidebar: KnoxGUIWebviewViewProvider,
  configHandler: ConfigHandler,
  verticalDiffManager: VerticalDiffManager,
  quickEdit: QuickEdit,
  core: Core,
  editDecorationManager: EditDecorationManager,
) => { [command: string]: (...args: any) => any } = (
  ide,
  extensionContext,
  sidebar,
  configHandler,
  verticalDiffManager,
  quickEdit,
  core,
  editDecorationManager,
) => {
  /**
   * Streams an inline edit to the vertical diff manager.
   *
   * This function retrieves the configuration, determines the appropriate model title,
   * increments the FTC count, and then streams an edit to the
   * vertical diff manager.
   *
   * @param  promptName - The key for the prompt in the context menu configuration.
   * @param  fallbackPrompt - The prompt to use if the configured prompt is not available.
   * @param  [onlyOneInsertion] - Optional. If true, only one insertion will be made.
   * @param  [range] - Optional. The range to edit if provided.
   * @returns
   */
  async function streamInlineEdit(
    promptName: keyof ContextMenuConfig,
    fallbackPrompt: string,
    onlyOneInsertion?: boolean,
    range?: vscode.Range,
  ) {
    const { config } = await configHandler.loadConfig();
    if (!config) {
      throw new Error("Configuration not loaded");
    }

    const modelTitle =
      config.selectedModelByRole.edit?.title ??
      (await sidebar.webviewProtocol.request(
        "getDefaultModelTitle",
        undefined,
      ));

    void sidebar.webviewProtocol.request("incrementFtc", undefined);

    await verticalDiffManager.streamEdit(
      config.experimental?.contextMenuPrompts?.[promptName] ?? fallbackPrompt,
      modelTitle,
      undefined,
      onlyOneInsertion,
      undefined,
      range,
    );
  }
  return {
    "knoxchat.acceptDiff": async (newFileUri?: string, streamId?: string) =>
      processDiff(
        "accept",
        sidebar,
        ide,
        verticalDiffManager,
        newFileUri,
        streamId,
      ),

    "knoxchat.rejectDiff": async (newFilepath?: string, streamId?: string) =>
      processDiff(
        "reject",
        sidebar,
        ide,
        verticalDiffManager,
        newFilepath,
        streamId,
      ),
    "knoxchat.acceptVerticalDiffBlock": (fileUri?: string, index?: number) => {
      verticalDiffManager.acceptRejectVerticalDiffBlock(true, fileUri, index);
    },
    "knoxchat.rejectVerticalDiffBlock": (fileUri?: string, index?: number) => {
      verticalDiffManager.acceptRejectVerticalDiffBlock(false, fileUri, index);
    },
    "knoxchat.quickFix": async (
      range: vscode.Range,
      diagnosticMessage: string,
    ) => {
      const prompt = t("commands.errorExplain", { message: diagnosticMessage });

      addCodeToContextFromRange(range, sidebar.webviewProtocol, prompt);

      vscode.commands.executeCommand("knoxchat.knoxGUIView.focus");
    },
    "knoxchat.defaultQuickAction": async (args: QuickEditShowParams) => {
      vscode.commands.executeCommand("knoxchat.focusEdit", args);
    },
    "knoxchat.customQuickActionSendToChat": async (
      prompt: string,
      range: vscode.Range,
    ) => {
      addCodeToContextFromRange(range, sidebar.webviewProtocol, prompt);

      vscode.commands.executeCommand("knoxchat.knoxGUIView.focus");
    },
    "knoxchat.customQuickActionStreamInlineEdit": async (
      prompt: string,
      range: vscode.Range,
    ) => {
      streamInlineEdit("docstring", prompt, false, range);
    },
    "knoxchat.focusKnoxInput": async () => {
      // GUI listener `focusKnoxInput`: save-if-history + clear code-to-edit,
      // then focus. Must NOT start a new session (use
      // `knoxchat.focusKnoxInputWithNewSession` for that).
      return vscode.commands.executeCommand("knox.native.focusInput");
    },
    "knoxchat.focusKnoxInputWithNewSession": async () => {
      return vscode.commands.executeCommand(
        "knox.native.focusInputWithNewSession",
      );
    },
    "knoxchat.focusKnoxInputWithoutClear": async () => {
      return vscode.commands.executeCommand("knox.native.focusInputWithoutClear");
    },
    // QuickEditShowParams are passed from CodeLens, temp fix
    // until we update to new params specific to Edit
    "knoxchat.focusEdit": async (args?: QuickEditShowParams) => {
      focusGUI();
      void vscode.commands.executeCommand("knox.native.focusEdit");

      const editor = vscode.window.activeTextEditor;

      if (!editor) {
        return;
      }

      const existingDiff = verticalDiffManager.getHandlerForFile(
        editor.document.fileName,
      );

      // If there's a diff currently being applied, then we just toggle focus back to the input
      if (existingDiff) {
        void vscode.commands.executeCommand("knox.native.focusInput");
        return;
      }

      const startFromCharZero = editor.selection.start.with(undefined, 0);
      const document = editor.document;
      let lastLine, lastChar;
      // If the user selected onto a trailing line but didn't actually include any characters in it
      // they don't want to include that line, so trim it off.
      if (editor.selection.end.character === 0) {
        // This is to prevent the rare case that the previous line gets selected when user
        // is selecting nothing and the cursor is at the beginning of the line
        if (editor.selection.end.line === editor.selection.start.line) {
          lastLine = editor.selection.start.line;
        } else {
          lastLine = editor.selection.end.line - 1;
        }
      } else {
        lastLine = editor.selection.end.line;
      }
      lastChar = document.lineAt(lastLine).range.end.character;
      const endAtCharLast = new vscode.Position(lastLine, lastChar);
      const range =
        args?.range ?? new vscode.Range(startFromCharZero, endAtCharLast);

      editDecorationManager.setDecoration(editor, range);

      const rangeInFileWithContents = getRangeInFileWithContents(true, range);

      if (rangeInFileWithContents) {
        sidebar.webviewProtocol?.request(
          "addCodeToEdit",
          rangeInFileWithContents,
        );

        // Un-select the current selection
        editor.selection = new vscode.Selection(
          editor.selection.anchor,
          editor.selection.anchor,
        );
      }
    },
    "knoxchat.focusEditWithoutClear": async () => {
      focusGUI();
      void vscode.commands.executeCommand("knox.native.focusEditWithoutClear");

      const editor = vscode.window.activeTextEditor;

      if (!editor) {
        return;
      }

      const document = editor.document;

      const existingDiff = verticalDiffManager.getHandlerForFile(
        document.fileName,
      );

      // If there's a diff currently being applied, then we just toggle focus back to the input
      if (existingDiff) {
        void vscode.commands.executeCommand("knox.native.focusInput");
        return;
      }

      const rangeInFileWithContents = getRangeInFileWithContents(false);

      if (rangeInFileWithContents) {
        sidebar.webviewProtocol?.request(
          "addCodeToEdit",
          rangeInFileWithContents,
        );
      } else {
        const contents = document.getText();

        sidebar.webviewProtocol?.request("addCodeToEdit", {
          filepath: document.uri.toString(),
          contents,
        });
      }
    },
    "knoxchat.exitEditMode": async () => {
      editDecorationManager.clear();
      void vscode.commands.executeCommand("knox.native.exitEditMode");
    },

    "knoxchat.writeCommentsForCode": async () => {
      streamInlineEdit(
        "comment",
        t("commands.writeComments"),
      );
    },
    "knoxchat.writeDocstringForCode": async () => {
      streamInlineEdit(
        "docstring",
        t("commands.writeDocstring"),
        true,
      );
    },
    "knoxchat.fixCode": async () => {
      streamInlineEdit(
        "fix",
        t("commands.fixCode"),
      );
    },
    "knoxchat.optimizeCode": async () => {
      streamInlineEdit("optimize", t("commands.optimizeCode"));
    },
    "knoxchat.fixGrammar": async () => {
      streamInlineEdit(
        "fixGrammar",
        t("commands.fixGrammar"),
      );
    },
    "knoxchat.viewLogs": async () => {
      vscode.commands.executeCommand("workbench.action.toggleDevTools");
    },
    "knoxchat.debugTerminal": async () => {
      const terminalContents = await ide.getTerminalContents();

      vscode.commands.executeCommand("knoxchat.knoxGUIView.focus");

      sidebar.webviewProtocol?.request("userInput", {
        input: t("commands.debugTerminal", { contents: terminalContents.trim() }),
      });
    },
    "knoxchat.hideInlineTip": () => {
      vscode.workspace
        .getConfiguration("knoxchat")
        .update("showInlineTip", false, vscode.ConfigurationTarget.Global);
    },

    // Commands without keyboard shortcuts
    "knoxchat.addModel": () => {
      return vscode.commands.executeCommand("knox.native.addModel");
    },
    "knoxchat.sendMainUserInput": (text: string) => {
      return vscode.commands.executeCommand("knox.native.sendUserInput", text);
    },
    "knoxchat.selectRange": (startLine: number, endLine: number) => {
      if (!vscode.window.activeTextEditor) {
        return;
      }
      vscode.window.activeTextEditor.selection = new vscode.Selection(
        startLine,
        0,
        endLine,
        0,
      );
    },
    "knoxchat.foldAndUnfold": (
      foldSelectionLines: number[],
      unfoldSelectionLines: number[],
    ) => {
      vscode.commands.executeCommand("editor.unfold", {
        selectionLines: unfoldSelectionLines,
      });
      vscode.commands.executeCommand("editor.fold", {
        selectionLines: foldSelectionLines,
      });
    },
    "knoxchat.sendToTerminal": (text: string) => {
      ide.runCommand(text);
    },
    "knoxchat.newSession": () => {
      return vscode.commands.executeCommand("knox.native.newSession");
    },
    "knoxchat.viewHistory": () => {
      return vscode.commands.executeCommand("knox.native.viewHistory");
    },
    "knoxchat.viewRestore": () => {
      return vscode.commands.executeCommand("knox.native.viewRestore");
    },
    "knoxchat.viewMemory": () => {
      return vscode.commands.executeCommand("knox.native.viewMemory");
    },
    "knoxchat.focusKnoxSessionId": async (
      sessionId: string | undefined,
    ) => {
      if (!sessionId) {
        sessionId = await vscode.window.showInputBox({
          prompt: t("commands.enterSessionId"),
        });
      }
      if (!sessionId) {
        return;
      }
      return vscode.commands.executeCommand("knox.native.focusSession", sessionId);
    },
    "knoxchat.applyCodeFromChat": () => {
      return vscode.commands.executeCommand("knox.native.applyCodeFromChat");
    },
    "knoxchat.openConfigPage": () => {
      return vscode.commands.executeCommand("knox.native.openConfig");
    },
    "knoxchat.selectFilesAsContext": async (
      firstUri: vscode.Uri,
      uris: vscode.Uri[],
    ) => {
      if (uris === undefined) {
        throw new Error("No files were selected");
      }

      vscode.commands.executeCommand("knoxchat.knoxGUIView.focus");

      for (const uri of uris) {
        // If it's a folder, add the entire folder contents recursively by using walkDir (to ignore ignored files)
        const isDirectory = await vscode.workspace.fs
          .stat(uri)
          ?.then((stat) => stat.type === vscode.FileType.Directory);
        if (isDirectory) {
          addEntireFileToContext(uri, sidebar.webviewProtocol);
        }
      }
    },
    "knoxchat.navigateTo": (path: string, toggle: boolean) => {
      return vscode.commands.executeCommand("knox.native.navigateTo", path, toggle);
    },

  };
};

const registerCopyBufferSpy = (
  context: vscode.ExtensionContext,
  core: Core,
) => {
  const typeDisposable = vscode.commands.registerCommand(
    "editor.action.clipboardCopyAction",
    async (arg) => doCopy(typeDisposable),
  );

  async function doCopy(typeDisposable: any) {
    typeDisposable.dispose(); // must dispose to avoid endless loops

    await vscode.commands.executeCommand("editor.action.clipboardCopyAction");

    const clipboardText = await vscode.env.clipboard.readText();

    if (clipboardText) {
      core.invoke("clipboardCache/add", {
        content: clipboardText,
      });
    }

    await context.workspaceState.update("knoxchat.copyBuffer", {
      text: clipboardText,
      copiedAt: new Date().toISOString(),
    });

    // re-register to knox intercepting copy commands
    typeDisposable = vscode.commands.registerCommand(
      "editor.action.clipboardCopyAction",
      async () => doCopy(typeDisposable),
    );
    context.subscriptions.push(typeDisposable);
  }

  context.subscriptions.push(typeDisposable);
};



export function registerAllCommands(
  context: vscode.ExtensionContext,
  ide: VsCodeIde,
  extensionContext: vscode.ExtensionContext,
  sidebar: KnoxGUIWebviewViewProvider,
  configHandler: ConfigHandler,
  verticalDiffManager: VerticalDiffManager,
  quickEdit: QuickEdit,
  core: Core,
  editDecorationManager: EditDecorationManager,
) {
  registerCopyBufferSpy(context, core);

  for (const [command, callback] of Object.entries(
    getCommandsMap(
      ide,
      extensionContext,
      sidebar,
      configHandler,
      verticalDiffManager,
      quickEdit,
      core,
      editDecorationManager,
    ),
  )) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, callback),
    );
  }
}
