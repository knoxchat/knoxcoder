/**
 * KN-342: vscode adapter for the applyToFile pipeline.
 */

import type { ILLM } from "core";
import { ConfigHandler } from "core/config/ConfigHandler";
import { getModelByRole } from "core/config/util";
import { applyCodeBlock } from "core/edit/lazy/applyCodeBlock";
import { getUriPathBasename } from "core/util/uri";
import * as vscode from "vscode";

import { ShadowWorkspaceManager } from "../agent/ShadowWorkspaceManager";
import {
  isShadowPreviewEnabled,
  isShadowPreviewLargeFilesEnabled,
} from "../agent/shadowWorkspace";
import { t } from "../i18n";
import { VsCodeIde } from "../VsCodeIde";
import { VsCodeWebviewProtocol } from "../webviewProtocol";
import { VerticalDiffManager } from "./vertical/manager";

import type {
  ApplyToFileError,
  ApplyToFileHost,
  ApplyStatePayload,
} from "./applyToFile";

export function createVsCodeApplyToFileHost(deps: {
  ide: VsCodeIde;
  webviewProtocol: VsCodeWebviewProtocol;
  verticalDiffManagerPromise: Promise<VerticalDiffManager>;
  configHandlerPromise: Promise<ConfigHandler>;
}): ApplyToFileHost {
  const { ide, webviewProtocol, verticalDiffManagerPromise, configHandlerPromise } =
    deps;

  return {
    fileExists: (filepath) => ide.fileExists(filepath),
    writeFile: (filepath, contents) => ide.writeFile(filepath, contents),
    openFile: (filepath) => ide.openFile(filepath),
    getActiveEditor() {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return undefined;
      }
      return {
        content: editor.document.getText(),
        fsPath: editor.document.uri.fsPath,
        uri: editor.document.uri.toString(),
        basename: getUriPathBasename(editor.document.uri.toString()),
        selectionEmpty: editor.selection.isEmpty,
      };
    },
    showError(error: ApplyToFileError, args) {
      if (error === "modelNotFound") {
        vscode.window.showErrorMessage(
          t("diff.modelNotFound", { title: args?.title ?? "" }),
        );
        return;
      }
      if (error === "failedLoadConfig") {
        vscode.window.showErrorMessage(t("diff.failedLoadConfig"));
        return;
      }
      vscode.window.showErrorMessage(t("diff.noActiveEditor"));
    },
    isShadowPreviewEnabled() {
      return isShadowPreviewEnabled((key) =>
        vscode.workspace.getConfiguration().get(key),
      );
    },
    allowShadowPreviewLargeFiles() {
      return isShadowPreviewLargeFilesEnabled((key) =>
        vscode.workspace.getConfiguration().get(key),
      );
    },
    previewAndAwaitDecision(filepath, proposedContent, streamId) {
      return ShadowWorkspaceManager.getInstance().previewAndAwaitDecision(
        filepath,
        proposedContent,
        { streamId, promptUser: true },
      );
    },
    async resolveApplyModels(curSelectedModelTitle) {
      const configHandler = await configHandlerPromise;
      const { config } = await configHandler.loadConfig();
      if (!config) {
        return { kind: "error", error: "failedLoadConfig" };
      }
      let llm: ILLM | null | undefined = config.selectedModelByRole.apply;
      if (!llm) {
        llm = config.models.find(
          (model) => model.title === curSelectedModelTitle,
        );
        if (!llm) {
          return {
            kind: "error",
            error: "modelNotFound",
            title: curSelectedModelTitle,
          };
        }
      }
      const fastLlm = getModelByRole(config, "repoMapFileSelection") ?? llm;
      return { kind: "ok", llm, fastLlm };
    },
    applyCodeBlock(oldFile, newFile, filename, llm, fastLlm) {
      return applyCodeBlock(oldFile, newFile, filename, llm, fastLlm);
    },
    async streamDiffLines(diffLines, instant, streamId, fileUri) {
      const verticalDiffManager = await verticalDiffManagerPromise;
      await verticalDiffManager.streamDiffLines(
        diffLines,
        instant,
        streamId,
        fileUri,
      );
    },
    async streamEdit({ prompt, modelTitle, streamId, useSelection, newCode }) {
      const verticalDiffManager = await verticalDiffManagerPromise;
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage(t("diff.noActiveEditor"));
        return;
      }
      const fullEditorRange = new vscode.Range(
        0,
        0,
        editor.document.lineCount - 1,
        editor.document.lineAt(editor.document.lineCount - 1).text.length,
      );
      const rangeToApplyTo =
        useSelection && !editor.selection.isEmpty
          ? editor.selection
          : fullEditorRange;
      await verticalDiffManager.streamEdit(
        prompt,
        modelTitle,
        streamId,
        undefined,
        undefined,
        rangeToApplyTo,
        newCode,
      );
    },
    async insertAtStart(text) {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      await editor.edit((builder) =>
        builder.insert(new vscode.Position(0, 0), text),
      );
    },
    notifyApplyState(state: ApplyStatePayload) {
      void webviewProtocol.request("updateApplyState", state);
    },
  };
}
