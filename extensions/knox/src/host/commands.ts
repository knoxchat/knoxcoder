 
import * as os from "node:os";
import * as path from "node:path";

import {
  ContextMenuConfig,
  RangeInFileWithContents,
} from "core";
import { ConfigHandler } from "core/config/ConfigHandler";
import { EXTENSION_NAME } from "core/config/extensionName";
import { Core } from "core/core";
import * as vscode from "vscode";
import type { VsCodeWebviewProtocol } from "./webviewProtocol";

import {
  CLIPBOARD_CACHE_ADD_MESSAGE,
  CLIPBOARD_COPY_COMMAND,
  COPY_BUFFER_STATE_KEY,
  copyBufferSpyResult,
} from "./activation/copyBuffer";
import {
  KNOX_FOCUS_INPUT_WITHOUT_CLEAR_MESSAGE,
  KNOX_SEND_USER_INPUT_MESSAGE,
  planOpenChat,
} from "./activation/knoxPublicApi";
import { t } from "./i18n";

import { CheckpointCommand } from "./checkpoints/commandIds";
import { BatchDiffManager } from "./diff/batchDiff/BatchDiffManager";
import { BatchDiffView } from "./diff/batchDiff/BatchDiffView";
import { BATCH_DIFF_COMMANDS } from "./diff/batchDiff/batchDiff";
import { VerticalDiffManager } from "./diff/vertical/manager";
import {
  acceptAllSuggestionsCommand,
  acceptSuggestionCommand,
  rejectAllSuggestionsCommand,
  rejectSuggestionCommand,
  type SuggestionRanges,
} from "./suggestions";
import { KnoxGUIWebviewViewProvider } from "./KnoxGUIWebviewViewProvider";
import { MemoryView } from "./memory/MemoryView";
import {
  NextEditState,
  buildNextEditPrompt,
  findAssistTargets,
  shouldOfferNextEdit,
  targetAtLine,
} from "core/edit/assist/editAssist";
import historyManager from "core/util/history";
import { primaryWorkspaceFsPath } from "./util/primaryWorkspace";
import {
  parseTranscriptMarkdown,
  transcriptToSession,
} from "core/util/transcriptImport";
import EditDecorationManager from "./quickEdit/EditDecorationManager";
import { QuickEdit, QuickEditShowParams } from "./quickEdit/QuickEditQuickPick";
import {
  ADD_CODE_TO_EDIT_MESSAGE,
  EXIT_EDIT_MODE_COMMAND,
  EXIT_EDIT_MODE_MESSAGE,
  FOCUS_EDIT_COMMAND,
  FOCUS_EDIT_MESSAGE,
  FOCUS_EDIT_WITHOUT_CLEAR_COMMAND,
  FOCUS_EDIT_WITHOUT_CLEAR_MESSAGE,
  buildCodeToEditPayload,
  buildWholeFileCodeToEdit,
  buildWholeLineEditRange,
  lastIncludedLineForEditSelection,
  leadingWhitespaceExpandsSelection,
  shouldSkipAddCodeToEdit,
} from "./quickEdit/editMode";
import { getMetaKeyLabel } from "./util/util";
import { VsCodeIde } from "./VsCodeIde";
import {
  buildHighlightedCodeRequest,
  buildQuickFixChatRequest,
  FOCUS_KNOX_GUI_COMMAND,
  HIGHLIGHTED_CODE_MESSAGE,
  QUICK_FIX_COMMAND,
} from "./lang-server/quickFix";
import {
  HIDE_INLINE_TIP_COMMAND,
  SHOW_INLINE_TIP_SETTING,
} from "./activation/inlineTip";

import { registerKnoxProductCommands } from "./knoxProductCommands";

let fullScreenPanel: vscode.WebviewPanel | undefined;

function getFullScreenTab() {
  const tabs = vscode.window.tabGroups.all.flatMap((tabGroup) => tabGroup.tabs);
  return tabs.find((tab) =>
    (tab.input as any)?.viewType?.endsWith("knoxchat.knoxGUIView"),
  );
}

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

  webviewProtocol?.request(
    HIGHLIGHTED_CODE_MESSAGE,
    prompt
      ? buildQuickFixChatRequest(rangeInFileWithContents, prompt)
      : buildHighlightedCodeRequest(rangeInFileWithContents, {
          shouldRun: true,
        }),
  );
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
      return buildCodeToEditPayload({
        filepath,
        contents: editor.document.getText(range),
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
      }) as RangeInFileWithContents;
    }

    if (selection.isEmpty && !allowEmpty) {
      return null;
    }

    let selectionRange = new vscode.Range(selection.start, selection.end);
    const document = editor.document;
    const beginningOfSelectionStartLine = selection.start.with(undefined, 0);
    const textBeforeSelectionStart = document.getText(
      new vscode.Range(beginningOfSelectionStartLine, selection.start),
    );
    if (leadingWhitespaceExpandsSelection(textBeforeSelectionStart)) {
      selectionRange = selectionRange.with({
        start: beginningOfSelectionStartLine,
      });
    }

    return buildCodeToEditPayload({
      filepath,
      contents: editor.document.getText(selectionRange),
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
    }) as RangeInFileWithContents;
  }

  return null;
}

async function addHighlightedCodeToContext(
  webviewProtocol: VsCodeWebviewProtocol | undefined,
) {
  const rangeInFileWithContents = getRangeInFileWithContents();
  if (rangeInFileWithContents) {
    webviewProtocol?.request(
      HIGHLIGHTED_CODE_MESSAGE,
      buildHighlightedCodeRequest(rangeInFileWithContents),
    );
  }
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

  webviewProtocol?.request(
    HIGHLIGHTED_CODE_MESSAGE,
    buildHighlightedCodeRequest(rangeInFileWithContents),
  );
}

function focusGUI() {
  const fullScreenTab = getFullScreenTab();
  if (fullScreenTab) {
    // focus fullscreen
    fullScreenPanel?.reveal();
  } else {
    // focus sidebar
    vscode.commands.executeCommand("knoxchat.knoxGUIView.focus");
    // vscode.commands.executeCommand("workbench.action.focusAuxiliaryBar");
  }
}

function hideGUI() {
  const fullScreenTab = getFullScreenTab();
  if (fullScreenTab) {
    // focus fullscreen
    fullScreenPanel?.dispose();
  } else {
    // focus sidebar
    vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
    // vscode.commands.executeCommand("workbench.action.toggleAuxiliaryBar");
  }
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
  await verticalDiffManager.clearForfileUri(newOrCurrentUri, action === "accept");

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

function waitForSidebarReady(
  sidebar: KnoxGUIWebviewViewProvider,
  timeout: number,
  interval: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const checkReadyState = () => {
      if (sidebar.isReady) {
        resolve(true);
      } else if (Date.now() - startTime >= timeout) {
        resolve(false); // Timed out
      } else {
        setTimeout(checkReadyState, interval);
      }
    };

    checkReadyState();
  });
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
  // In-editor assist: one instruction edit on a range, then at most one
  // related follow-up offered after the user accepts it.
  let assistState: NextEditState | undefined;

  async function runAssistEdit(
    uri: string,
    startLine: number,
    endLine: number,
    prompt: string,
    followUp: boolean,
  ) {
    const { config } = await configHandler.loadConfig();
    if (!config) {
      throw new Error("Configuration not loaded");
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
    const editor = await vscode.window.showTextDocument(document);
    const last = Math.min(endLine, document.lineCount - 1);
    const range = new vscode.Range(
      new vscode.Position(startLine, 0),
      new vscode.Position(last, document.lineAt(last).range.end.character),
    );
    editor.selection = new vscode.Selection(range.start, range.end);
    const modelTitle =
      config.selectedModelByRole.edit?.title ??
      (await sidebar.webviewProtocol.request("getDefaultModelTitle", undefined));
    assistState = { fileUri: document.uri.toString(), prompt, followUp };
    await verticalDiffManager.streamEdit(
      prompt,
      modelTitle,
      undefined,
      undefined,
      undefined,
      range,
    );
  }

  verticalDiffManager.onEditAccepted = (fileUri) => {
    const nextEnabled =
      vscode.workspace.getConfiguration("knoxchat").get<boolean>("editAssist.nextEdit") ?? true;
    const state = assistState;
    if (!shouldOfferNextEdit(state, fileUri, nextEnabled) || !state) {
      return;
    }
    assistState = undefined;
    void vscode.window
      .showInformationMessage(
        "Knox: look for one related edit in this file?",
        "Show one edit",
        "No thanks",
      )
      .then(async (choice) => {
        if (choice !== "Show one edit") {
          return;
        }
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(state.fileUri));
        await runAssistEdit(
          state.fileUri,
          0,
          doc.lineCount - 1,
          buildNextEditPrompt(state.prompt),
          true,
        );
      });
  }

  return {
    "knox.editAssist.run": async (arg?: {
      uri: string;
      startLine: number;
      endLine: number;
      prompt: string;
    }) => {
      if (!arg) {
        return;
      }
      await runAssistEdit(arg.uri, arg.startLine, arg.endLine, arg.prompt, false);
    },
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
    [BATCH_DIFF_COMMANDS.show]: () => {
      BatchDiffView.createOrShow();
    },
    [BATCH_DIFF_COMMANDS.acceptAll]: () => {
      const batch = BatchDiffManager.getInstance();
      batch.setVerticalDiffManager(verticalDiffManager);
      return batch.applyAll("accept");
    },
    [BATCH_DIFF_COMMANDS.rejectAll]: () => {
      const batch = BatchDiffManager.getInstance();
      batch.setVerticalDiffManager(verticalDiffManager);
      return batch.applyAll("reject");
    },
    [BATCH_DIFF_COMMANDS.acceptSelected]: (fileUris: string[]) => {
      const batch = BatchDiffManager.getInstance();
      batch.setVerticalDiffManager(verticalDiffManager);
      return batch.applySelected("accept", fileUris ?? []);
    },
    [BATCH_DIFF_COMMANDS.rejectSelected]: (fileUris: string[]) => {
      const batch = BatchDiffManager.getInstance();
      batch.setVerticalDiffManager(verticalDiffManager);
      return batch.applySelected("reject", fileUris ?? []);
    },
    "knoxchat.acceptSuggestion": (key?: SuggestionRanges) => {
      acceptSuggestionCommand(key ?? null);
    },
    "knoxchat.rejectSuggestion": (key?: SuggestionRanges) => {
      void rejectSuggestionCommand(key ?? null);
    },
    "knoxchat.acceptAllSuggestions": () => {
      acceptAllSuggestionsCommand();
    },
    "knoxchat.rejectAllSuggestions": () => {
      rejectAllSuggestionsCommand();
    },
    [QUICK_FIX_COMMAND]: async (
      range: vscode.Range,
      diagnosticMessage: string,
    ) => {
      const prompt = t("commands.errorExplain", { message: diagnosticMessage });

      addCodeToContextFromRange(range, sidebar.webviewProtocol, prompt);

      vscode.commands.executeCommand(FOCUS_KNOX_GUI_COMMAND);
    },
    "knoxchat.defaultQuickAction": async (args: QuickEditShowParams) => {
      vscode.commands.executeCommand(FOCUS_EDIT_COMMAND, args);
    },
    "knoxchat.customQuickActionSendToChat": async (
      prompt: string,
      range: vscode.Range,
    ) => {
      addCodeToContextFromRange(range, sidebar.webviewProtocol, prompt);

      vscode.commands.executeCommand(FOCUS_KNOX_GUI_COMMAND);
    },
    "knoxchat.customQuickActionStreamInlineEdit": async (
      prompt: string,
      range: vscode.Range,
    ) => {
      streamInlineEdit("docstring", prompt, false, range);
    },
    "knoxchat.focusKnoxInput": async () => {
      const isKnoxInputFocused = await sidebar.webviewProtocol.request(
        "isKnoxInputFocused",
        undefined,
        false,
      );

      // This is a temporary fix—sidebar.webviewProtocol.request is blocking
      // when the GUI hasn't yet been setup and we should instead be
      // immediately throwing an error, or returning a Result object
      focusGUI();
      if (!sidebar.isReady) {
        const isReady = await waitForSidebarReady(sidebar, 5000, 100);
        if (!isReady) {
          return;
        }
      }

      const historyLength = await sidebar.webviewProtocol.request(
        "getWebviewHistoryLength",
        undefined,
        false,
      );

      if (isKnoxInputFocused) {
        if (historyLength === 0) {
          hideGUI();
        } else {
          void sidebar.webviewProtocol?.request(
            "focusKnoxInputWithNewSession",
            undefined,
            false,
          );
        }
      } else {
        focusGUI();
        sidebar.webviewProtocol?.request(
          "focusKnoxInputWithNewSession",
          undefined,
          false,
        );
        void addHighlightedCodeToContext(sidebar.webviewProtocol);
      }
    },
    "knoxchat.focusKnoxInputWithoutClear": async () => {
      const isKnoxInputFocused = await sidebar.webviewProtocol.request(
        "isKnoxInputFocused",
        undefined,
        false,
      );

      // This is a temporary fix—sidebar.webviewProtocol.request is blocking
      // when the GUI hasn't yet been setup and we should instead be
      // immediately throwing an error, or returning a Result object
      focusGUI();
      if (!sidebar.isReady) {
        const isReady = await waitForSidebarReady(sidebar, 5000, 100);
        if (!isReady) {
          return;
        }
      }

      if (isKnoxInputFocused) {
        hideGUI();
      } else {
        focusGUI();

        sidebar.webviewProtocol?.request(
          "focusKnoxInputWithoutClear",
          undefined,
        );

        void addHighlightedCodeToContext(sidebar.webviewProtocol);
      }
    },
    // QuickEditShowParams are passed from CodeLens, temp fix
    // until we update to new params specific to Edit
    [FOCUS_EDIT_COMMAND]: async (args?: QuickEditShowParams) => {
      focusGUI();

      sidebar.webviewProtocol?.request(FOCUS_EDIT_MESSAGE, undefined);

      const editor = vscode.window.activeTextEditor;

      if (!editor) {
        return;
      }

      const existingDiff = verticalDiffManager.getHandlerForFile(
        editor.document.fileName,
      );

      if (shouldSkipAddCodeToEdit(Boolean(existingDiff))) {
        sidebar.webviewProtocol?.request("focusKnoxInput", undefined);
        return;
      }

      const document = editor.document;
      const sel = {
        startLine: editor.selection.start.line,
        startCharacter: editor.selection.start.character,
        endLine: editor.selection.end.line,
        endCharacter: editor.selection.end.character,
      };
      let lastLine = lastIncludedLineForEditSelection(sel);
      if (editor.selection.isEmpty && !args?.range) {
        // Empty selection on a stub / TODO / empty file: scope the edit to it.
        const target = targetAtLine(
          findAssistTargets(document.getText(), document.languageId),
          sel.startLine,
        );
        if (target) {
          sel.startLine = target.startLine;
          sel.startCharacter = 0;
          sel.endLine = target.endLine;
          sel.endCharacter = document.lineAt(target.endLine).range.end.character;
          lastLine = target.endLine;
        }
      }
      const computed = buildWholeLineEditRange(
        sel,
        document.lineAt(lastLine).range.end.character,
      );
      const vscodeRange =
        args?.range ??
        new vscode.Range(
          new vscode.Position(computed.start.line, computed.start.character),
          new vscode.Position(computed.end.line, computed.end.character),
        );

      editDecorationManager.setDecoration(editor, vscodeRange);

      const rangeInFileWithContents = getRangeInFileWithContents(true, vscodeRange);

      if (rangeInFileWithContents) {
        sidebar.webviewProtocol?.request(
          ADD_CODE_TO_EDIT_MESSAGE,
          rangeInFileWithContents,
        );

        editor.selection = new vscode.Selection(
          editor.selection.anchor,
          editor.selection.anchor,
        );
      }
    },
    [FOCUS_EDIT_WITHOUT_CLEAR_COMMAND]: async () => {
      focusGUI();

      sidebar.webviewProtocol?.request(FOCUS_EDIT_WITHOUT_CLEAR_MESSAGE, undefined);

      const editor = vscode.window.activeTextEditor;

      if (!editor) {
        return;
      }

      const document = editor.document;

      const existingDiff = verticalDiffManager.getHandlerForFile(
        document.fileName,
      );

      if (shouldSkipAddCodeToEdit(Boolean(existingDiff))) {
        sidebar.webviewProtocol?.request("focusKnoxInput", undefined);
        return;
      }

      const rangeInFileWithContents = getRangeInFileWithContents(false);

      if (rangeInFileWithContents) {
        sidebar.webviewProtocol?.request(
          ADD_CODE_TO_EDIT_MESSAGE,
          rangeInFileWithContents,
        );
      } else {
        sidebar.webviewProtocol?.request(
          ADD_CODE_TO_EDIT_MESSAGE,
          buildWholeFileCodeToEdit(document.uri.toString(), document.getText()),
        );
      }
    },
    [EXIT_EDIT_MODE_COMMAND]: async () => {
      editDecorationManager.clear();
      void sidebar.webviewProtocol?.request(EXIT_EDIT_MODE_MESSAGE, undefined);
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
    [HIDE_INLINE_TIP_COMMAND]: () => {
      vscode.workspace
        .getConfiguration()
        .update(SHOW_INLINE_TIP_SETTING, false, vscode.ConfigurationTarget.Global);
    },

    // Commands without keyboard shortcuts
    "knoxchat.addModel": () => {
      vscode.commands.executeCommand("knoxchat.knoxGUIView.focus");
      sidebar.webviewProtocol?.request("addModel", undefined);
    },
    "knoxchat.sendMainUserInput": (text: string) => {
      sidebar.webviewProtocol?.request("userInput", {
        input: text,
      });
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
      void vscode.commands.executeCommand("workbench.action.knox.nativeNewSession");
      sidebar.webviewProtocol?.request("newSession", undefined);
    },
    "knoxchat.viewHistory": () => {
      vscode.commands.executeCommand("knoxchat.navigateTo", "/history", true);
    },
    "knoxchat.viewRestore": () => {
      vscode.commands.executeCommand(CheckpointCommand.view);
    },
    "knoxchat.viewMemory": () => {
      try {
        MemoryView.createOrShow(extensionContext, core);
      } catch (error) {
        vscode.window.showErrorMessage(t("memory.view.failedShow", { error }));
      }
    },
    "knox.session.importTranscript": async (
      file?: string | vscode.Uri,
    ) => {
      let target: vscode.Uri | undefined;
      if (typeof file === "string" && file.trim()) {
        const confirm = await vscode.window.showInformationMessage(
          `Import Knox transcript from ${path.basename(file)}?`,
          "Import",
        );
        if (confirm !== "Import") {
          return;
        }
        target = vscode.Uri.file(file);
      } else if (file instanceof vscode.Uri) {
        target = file;
      } else {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { Markdown: ["md", "markdown", "txt"] },
          openLabel: "Import transcript",
        });
        target = picked?.[0];
      }
      if (!target) {
        return;
      }
      const bytes = await vscode.workspace.fs.readFile(target);
      const parsed = parseTranscriptMarkdown(Buffer.from(bytes).toString("utf8"));
      if (!parsed) {
        void vscode.window.showErrorMessage(
          "Knox: no User/Assistant turns found, or the file is over 5 MB. Use a transcript from /share or Export as Markdown.",
        );
        return;
      }
      const session = transcriptToSession(
        parsed,
        primaryWorkspaceFsPath() ?? "",
      );
      historyManager.save(session);
      if (parsed.truncated) {
        void vscode.window.showWarningMessage(
          "Knox: transcript was long; imported the last 2000 messages.",
        );
      }
      void vscode.commands.executeCommand(
        "knoxchat.focusKnoxSessionId",
        session.sessionId,
      );
    },
    "knoxchat.focusKnoxSessionId": async (
      sessionId: string | undefined,
    ) => {
      if (!sessionId) {
        sessionId = await vscode.window.showInputBox({
          prompt: t("commands.enterSessionId"),
        });
      }
      void sidebar.webviewProtocol?.request("focusKnoxSessionId", {
        sessionId,
      });
    },
    "knoxchat.applyCodeFromChat": () => {
      void vscode.commands.executeCommand("workbench.action.knox.applyCodeFromChat");
      void sidebar.webviewProtocol.request("applyCodeFromChat", undefined);
    },
    "knoxchat.openConfigPage": () => {
      void vscode.commands.executeCommand("workbench.action.knox.openConfigPage");
      vscode.commands.executeCommand("knoxchat.navigateTo", "/config", true);
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
      sidebar.webviewProtocol?.request("navigateTo", { path, toggle });
      focusGUI();
    },
    // Public / workbench API (KN-100, KN-115, KN-364). Always focuses; does not toggle closed.
    "knox.openChat": async (options?: { prompt?: string }) => {
      focusGUI();
      if (!sidebar.isReady) {
        const isReady = await waitForSidebarReady(sidebar, 5000, 100);
        if (!isReady) {
          return;
        }
      }
      const plan = planOpenChat(options);
      if (plan.kind === "focusAndSubmit") {
        sidebar.webviewProtocol?.request(KNOX_SEND_USER_INPUT_MESSAGE, {
          input: plan.prompt,
        });
        return;
      }
      sidebar.webviewProtocol?.request(
        KNOX_FOCUS_INPUT_WITHOUT_CLEAR_MESSAGE,
        undefined,
      );
    },
    "knox.newSession": () => {
      vscode.commands.executeCommand("knoxchat.newSession");
      focusGUI();
    },

  };
};

/** KN-356: intercept copy so `@clipboard` and IDE.getClipboardContent stay in sync. */
const registerCopyBufferSpy = (
  context: vscode.ExtensionContext,
  core: Core,
) => {
  const typeDisposable = vscode.commands.registerCommand(
    CLIPBOARD_COPY_COMMAND,
    async (arg) => doCopy(typeDisposable),
  );

  async function doCopy(typeDisposable: any) {
    typeDisposable.dispose(); // must dispose to avoid endless loops

    await vscode.commands.executeCommand(CLIPBOARD_COPY_COMMAND);

    const clipboardText = await vscode.env.clipboard.readText();
    const result = copyBufferSpyResult(
      clipboardText,
      new Date().toISOString(),
    );

    if (result.cache) {
      core.invoke(CLIPBOARD_CACHE_ADD_MESSAGE, result.cache);
    }

    await context.workspaceState.update(COPY_BUFFER_STATE_KEY, result.state);

    // re-register to knox intercepting copy commands
    typeDisposable = vscode.commands.registerCommand(
      CLIPBOARD_COPY_COMMAND,
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
  registerKnoxProductCommands(context, ide);

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
