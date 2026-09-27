/**
 * KN-345: vscode decoration adapter for inline tips.
 * Placement / gating live in `inlineTip.ts` so mocha can run without vscode.
 */

import { EXTENSION_NAME } from "core/config/extensionName";
import svgBuilder from "svg-builder";
import * as vscode from "vscode";

import { t } from "../i18n";
import { getTheme } from "../util/getTheme";
import { getMetaKeyLabel, getMetaKeyName } from "../util/util";

import {
  calculateInlineTipPosition,
  emptyFileTipText,
  hideInlineTipHoverMarkdown,
  HIDE_INLINE_TIP_COMMAND,
  INLINE_TIP_CHAT_KEY,
  INLINE_TIP_DEBOUNCE_MS,
  INLINE_TIP_EDIT_KEY,
  inlineTipShortcut,
  shouldRenderInlineTip,
  SHOW_INLINE_TIP_SETTING,
} from "./inlineTip";

const SVG_CONFIG = {
  stroke: "#159994",
  strokeWidth: 1,
  shortcutColor: "#159994",
  filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.2))",
  radius: 3,
  leftMargin: 40,
  debounceDelay: INLINE_TIP_DEBOUNCE_MS,
  get chatLabel() { return t("inlineTip.chat"); },
  chatShortcut: inlineTipShortcut(getMetaKeyLabel(), INLINE_TIP_CHAT_KEY),
  get editLabel() { return t("inlineTip.edit"); },
  editShortcut: inlineTipShortcut(getMetaKeyLabel(), INLINE_TIP_EDIT_KEY),

  get fontSize() {
    return Math.ceil(
      (vscode.workspace.getConfiguration("editor").get<number>("fontSize") ??
        14) * 0.8,
    );
  },
  get fontFamily() {
    return (
      vscode.workspace.getConfiguration("editor").get<string>("fontFamily") ||
      "helvetica"
    );
  },
  get paddingX() {
    return Math.ceil(this.getEstimatedTextWidth(" "));
  },
  get gap() {
    return this.fontSize * 0.5;
  },
  get tipWidth() {
    return (
      this.editShortcutX +
      this.getEstimatedTextWidth(this.editShortcut) +
      this.paddingX
    );
  },
  get tipHeight() {
    return this.fontSize;
  },
  get textY() {
    return (this.tipHeight + this.fontSize) / 2;
  },
  get chatLabelX() {
    return this.paddingX;
  },
  get chatShortcutX() {
    return this.chatLabelX + this.getEstimatedTextWidth(this.chatLabel + " ");
  },
  get editLabelX() {
    return (
      this.chatShortcutX +
      this.getEstimatedTextWidth(this.chatShortcut) +
      this.gap
    );
  },
  get editShortcutX() {
    return this.editLabelX + this.getEstimatedTextWidth(this.editLabel + " ");
  },
  getEstimatedTextWidth(text: string): number {
    return text.length * this.fontSize * 0.6;
  },
} as const;

export class InlineTipManager {
  private static instance: InlineTipManager;

  private readonly hideCommand = HIDE_INLINE_TIP_COMMAND;
  private svgTooltip: vscode.Uri | undefined = undefined;

  private debounceTimer: NodeJS.Timeout | undefined;
  private lastActiveEditor?: vscode.TextEditor;
  private theme = getTheme();
  private svgTooltipDecoration = this.createSvgTooltipDecoration();
  private emptyFileTooltipDecoration = this.createEmptyFileTooltipDecoration();

  public static getInstance(): InlineTipManager {
    if (!InlineTipManager.instance) {
      InlineTipManager.instance = new InlineTipManager();
    }
    return InlineTipManager.instance;
  }

  private constructor() {
    this.createSvgTooltip();
    this.setupSvgTipListeners();
  }

  public setupInlineTips(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.window.onDidChangeTextEditorSelection((e) => {
        this.handleSelectionChange(e);
      }),
    );

    this.setupEmptyFileTips(context);

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration(SHOW_INLINE_TIP_SETTING)) {
          return;
        }
        for (const editor of vscode.window.visibleTextEditors) {
          if (!this.shouldRenderTip(editor.document.uri)) {
            editor.setDecorations(this.svgTooltipDecoration, []);
            editor.setDecorations(this.emptyFileTooltipDecoration, []);
          }
        }
      }),
    );

    context.subscriptions.push(this);
  }

  public handleSelectionChange(e: vscode.TextEditorSelectionChangeEvent) {
    const selection = e.selections[0];
    const editor = e.textEditor;

    if (selection.isEmpty || !this.shouldRenderTip(editor.document.uri)) {
      editor.setDecorations(this.svgTooltipDecoration, []);
      return;
    }

    this.debouncedSelectionChange(editor, selection);
  }

  public dispose() {
    this.svgTooltipDecoration.dispose();
    this.emptyFileTooltipDecoration.dispose();

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
  }

  private debouncedSelectionChange(
    editor: vscode.TextEditor,
    selection: vscode.Selection,
  ) {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      // Clear decoration from previous editor
      if (this.lastActiveEditor && this.lastActiveEditor !== editor) {
        this.lastActiveEditor.setDecorations(this.svgTooltipDecoration, []);
      }

      this.lastActiveEditor = editor;

      this.updateTooltipPosition(editor, selection);
    }, SVG_CONFIG.debounceDelay);
  }

  private setupSvgTipListeners() {
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("workbench.colorTheme")) {
        this.theme = getTheme();
        this.createSvgTooltip();
      }
    });

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("editor.fontSize")) {
        this.createSvgTooltip();
      }
    });
  }

  private shouldRenderTip(uri: vscode.Uri): boolean {
    return shouldRenderInlineTip({
      uri: uri.toString(),
      scheme: uri.scheme,
      enabled:
        vscode.workspace
          .getConfiguration(EXTENSION_NAME)
          .get<boolean>("showInlineTip") === true,
    });
  }

  private setupEmptyFileTips(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (
          editor?.document.getText() === "" &&
          this.shouldRenderTip(editor.document.uri)
        ) {
          editor.setDecorations(this.emptyFileTooltipDecoration, [
            {
              range: new vscode.Range(
                new vscode.Position(0, Number.MAX_VALUE),
                new vscode.Position(0, Number.MAX_VALUE),
              ),
            },
          ]);
        }
      }),
    );

    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (
          e.document.getText() === "" &&
          this.shouldRenderTip(e.document.uri)
        ) {
          vscode.window.visibleTextEditors.forEach((editor) => {
            editor.setDecorations(this.emptyFileTooltipDecoration, [
              {
                range: new vscode.Range(
                  new vscode.Position(0, Number.MAX_VALUE),
                  new vscode.Position(0, Number.MAX_VALUE),
                ),
              },
            ]);
          });
        } else {
          vscode.window.visibleTextEditors.forEach((editor) => {
            editor.setDecorations(this.emptyFileTooltipDecoration, []);
          });
        }
      }),
    );
  }

  private createEmptyFileTooltipDecoration() {
    return vscode.window.createTextEditorDecorationType({
      after: {
        contentText: emptyFileTipText(getMetaKeyName()),
        color: "#159994",
        margin: "2em 0 0 0",
        fontStyle: "italic",
      },
    });
  }

  private createSvgTooltipDecoration() {
    var backgroundColour = 0;
    if (this.theme) {
      backgroundColour = this.theme.colors["editor.background"];
    }
    return vscode.window.createTextEditorDecorationType({
      after: {
        contentIconPath: this.svgTooltip,
        border: `;box-shadow: inset 0 0 0 ${SVG_CONFIG.strokeWidth}px ${SVG_CONFIG.stroke}, inset 0 0 0 ${SVG_CONFIG.tipHeight}px ${backgroundColour};
                  border-radius: ${SVG_CONFIG.radius}px;
                  filter: ${SVG_CONFIG.filter}`,
        margin: `0 0 0 ${SVG_CONFIG.leftMargin}px`,
        width: `${SVG_CONFIG.tipWidth}px`,
      },
    });
  }

  private createSvgTooltip() {
    const baseTextConfig = {
      y: SVG_CONFIG.textY,
      "font-family": SVG_CONFIG.fontFamily,
      "font-size": SVG_CONFIG.fontSize,
    };

    if (!this.theme) {
      return;
    }

    try {
      const svgContent = svgBuilder
        .create()
        .width(SVG_CONFIG.tipWidth)
        .height(SVG_CONFIG.tipHeight)
        // Chat
        .text(
          {
            ...baseTextConfig,
            x: SVG_CONFIG.chatLabelX,
            fill: this.theme.colors["editor.foreground"],
          },
          SVG_CONFIG.chatLabel,
        )
        .text(
          {
            ...baseTextConfig,
            x: SVG_CONFIG.chatShortcutX,
            fill: SVG_CONFIG.shortcutColor,
          },
          SVG_CONFIG.chatShortcut,
        )
        // Edit
        .text(
          {
            ...baseTextConfig,
            x: SVG_CONFIG.editLabelX,
            fill: this.theme.colors["editor.foreground"],
          },
          SVG_CONFIG.editLabel,
        )
        .text(
          {
            ...baseTextConfig,
            x: SVG_CONFIG.editShortcutX,
            fill: SVG_CONFIG.shortcutColor,
          },
          SVG_CONFIG.editShortcut,
        )
        .render();

      const dataUri = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString("base64")}`;

      this.svgTooltip = vscode.Uri.parse(dataUri);
      this.svgTooltipDecoration.dispose();
      this.svgTooltipDecoration = this.createSvgTooltipDecoration();
    } catch (error) {
      console.error("Error creating SVG for inline tip:", error);
    }
  }

  private buildHideTooltipHoverMsg() {
    const hoverMarkdown = new vscode.MarkdownString(
      hideInlineTipHoverMarkdown(this.hideCommand),
    );

    hoverMarkdown.isTrusted = true;
    hoverMarkdown.supportHtml = true;
    return hoverMarkdown;
  }

  private updateTooltipPosition(
    editor: vscode.TextEditor,
    selection: vscode.Selection,
  ) {
    const position = calculateInlineTipPosition(
      {
        lineCount: editor.document.lineCount,
        lineText: (line) => editor.document.lineAt(line).text,
      },
      {
        startLine: selection.start.line,
        startCharacter: selection.start.character,
        endLine: selection.end.line,
        endCharacter: selection.end.character,
      },
    );

    if (!position) {
      editor.setDecorations(this.svgTooltipDecoration, []);
      return;
    }

    const vscodePosition = new vscode.Position(
      position.line,
      position.character,
    );
    editor.setDecorations(this.svgTooltipDecoration, [
      {
        range: new vscode.Range(vscodePosition, vscodePosition),
        hoverMessage: [this.buildHideTooltipHoverMsg()],
      },
    ]);
  }
}

export default function setupInlineTips(context: vscode.ExtensionContext) {
  InlineTipManager.getInstance().setupInlineTips(context);
}
