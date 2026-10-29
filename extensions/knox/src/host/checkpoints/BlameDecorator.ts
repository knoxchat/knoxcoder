/**
 * Editor gutter / hover for checkpoint line blame (CP-44).
 */

import * as path from 'node:path';

import * as vscode from 'vscode';

import { t } from '../i18n';
import { CheckpointCommand, registerCanonicalCommand } from './commandIds';
import { CheckpointGraphView } from './CheckpointGraphView';
import { CheckpointManager } from './CheckpointManager';
import { uriFromFileHistoryArg } from './fileHistoryCommands';
import { findContainingWorkspaceFolder } from './manager/workspace';
import { toPosixRelative } from './manager/pathFilter';
import { tryResolveSandboxedWorkspacePath } from './checkpointPath';
import type { BlameLine } from './manager/types';

export class BlameDecorator implements vscode.Disposable {
    private static instance: BlameDecorator | undefined;
    private readonly decoration: vscode.TextEditorDecorationType;
    private readonly disposables: vscode.Disposable[] = [];
    private enabled = false;
    private readonly blamed = new Map<string, BlameLine[]>();

    private constructor() {
        this.decoration = vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 2em',
                color: new vscode.ThemeColor('editorCodeLens.foreground'),
            },
        });
        this.disposables.push(
            this.decoration,
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (this.enabled && editor) {
                    void this.showForEditor(editor);
                }
            }),
            vscode.workspace.onDidSaveTextDocument((document) => {
                if (!this.enabled) {
                    return;
                }
                const editor = vscode.window.visibleTextEditors.find((item) => item.document === document);
                if (editor) {
                    void this.showForEditor(editor);
                }
            }),
        );
    }

    static getInstance(): BlameDecorator {
        if (!BlameDecorator.instance) {
            BlameDecorator.instance = new BlameDecorator();
        }
        return BlameDecorator.instance;
    }

    dispose(): void {
        for (const item of this.disposables) {
            item.dispose();
        }
        this.blamed.clear();
        BlameDecorator.instance = undefined;
    }

    blameEnabled(): boolean {
        return vscode.workspace.getConfiguration('knox.checkpoints').get<boolean>('blame', true);
    }

    async maybeAutoShow(): Promise<void> {
        if (!this.blameEnabled()) {
            return;
        }
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            await this.showForEditor(editor);
        }
    }

    hide(): void {
        this.enabled = false;
        this.blamed.clear();
        for (const editor of vscode.window.visibleTextEditors) {
            editor.setDecorations(this.decoration, []);
        }
    }

    async showForEditor(editor: vscode.TextEditor): Promise<void> {
        if (!this.blameEnabled()) {
            this.hide();
            return;
        }
        const checkpointManager = CheckpointManager.getInstance();
        if (!checkpointManager.isReady()) {
            vscode.window.showErrorMessage(t('checkpoint.systemNotInit'));
            return;
        }
        const uri = editor.document.uri;
        if (uri.scheme !== 'file') {
            return;
        }
        const folders = checkpointManager.workspaceFolderPaths.length > 0
            ? checkpointManager.workspaceFolderPaths
            : (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
        const folder = findContainingWorkspaceFolder(folders, uri.fsPath);
        if (!folder) {
            return;
        }
        const relativePath = toPosixRelative(path.relative(folder, uri.fsPath));
        const sandboxed = tryResolveSandboxedWorkspacePath(folder, relativePath);
        if (!sandboxed.ok || !relativePath || relativePath.startsWith('../')) {
            return;
        }
        await checkpointManager.switchWorkspaceFolder(folder);
        const result = await checkpointManager.blameFile(relativePath);
        if (result.unsupported === 'binary') {
            vscode.window.showInformationMessage(t('checkpoint.blame.unsupported'));
            return;
        }
        this.enabled = true;
        this.blamed.set(uri.toString(), result.lines);
        this.apply(editor, result.lines);
    }

    blamedLine(uri: vscode.Uri, line: number): BlameLine | undefined {
        return this.blamed.get(uri.toString())?.find((entry) => entry.line === line);
    }

    private apply(editor: vscode.TextEditor, lines: BlameLine[]): void {
        const decorations: vscode.DecorationOptions[] = [];
        let lastId: string | undefined;
        for (const entry of lines) {
            if (!entry.checkpointId || entry.checkpointId === lastId) {
                lastId = entry.checkpointId;
                continue;
            }
            lastId = entry.checkpointId;
            const range = new vscode.Range(entry.line - 1, Number.MAX_SAFE_INTEGER, entry.line - 1, Number.MAX_SAFE_INTEGER);
            const title = entry.label || entry.description || entry.checkpointId.slice(0, 11);
            const hover = new vscode.MarkdownString(undefined, true);
            hover.isTrusted = true;
            hover.appendMarkdown(`**${title}**  \n\`${entry.checkpointId}\``);
            if (entry.originPath) {
                hover.appendMarkdown(`  \n${entry.originPath}`);
            }
            hover.appendMarkdown(
                `  \n[${t('checkpoint.blame.openGraph')}](command:${CheckpointCommand.revealBlamed}?${encodeURIComponent(JSON.stringify([entry.checkpointId]))})`,
            );
            decorations.push({
                range,
                hoverMessage: hover,
                renderOptions: {
                    after: {
                        contentText: `  ${entry.checkpointId.slice(0, 11)}  ${title}`,
                    },
                },
            });
        }
        editor.setDecorations(this.decoration, decorations);
    }
}

export async function showCheckpointBlame(arg?: unknown): Promise<void> {
    const editor = arg instanceof vscode.Uri
        ? vscode.window.visibleTextEditors.find((item) => item.document.uri.toString() === arg.toString())
            ?? vscode.window.activeTextEditor
        : vscode.window.activeTextEditor;
    const uri = uriFromFileHistoryArg(arg) ?? editor?.document.uri;
    if (!uri || !editor) {
        vscode.window.showInformationMessage(t('checkpoint.blame.noFile'));
        return;
    }
    try {
        await BlameDecorator.getInstance().showForEditor(editor);
        vscode.window.setStatusBarMessage(t('checkpoint.blame.shown'), 3000);
    } catch (error) {
        vscode.window.showErrorMessage(t('checkpoint.blame.failed', { error }));
    }
}

export function hideCheckpointBlame(): void {
    BlameDecorator.getInstance().hide();
    vscode.window.setStatusBarMessage(t('checkpoint.blame.hidden'), 2000);
}

export function revealBlamedCheckpoint(arg?: unknown): void {
    const checkpointId = typeof arg === 'string'
        ? arg
        : Array.isArray(arg) && typeof arg[0] === 'string'
            ? arg[0]
            : undefined;
    if (!checkpointId) {
        const editor = vscode.window.activeTextEditor;
        const line = editor ? editor.selection.active.line + 1 : 0;
        const blamed = editor ? BlameDecorator.getInstance().blamedLine(editor.document.uri, line) : undefined;
        if (!blamed?.checkpointId) {
            vscode.window.showInformationMessage(t('checkpoint.blame.unknown'));
            return;
        }
        CheckpointGraphView.selectCheckpoint(blamed.checkpointId);
        return;
    }
    CheckpointGraphView.selectCheckpoint(checkpointId);
}

export function registerBlameCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(BlameDecorator.getInstance());
    registerCanonicalCommand(context, CheckpointCommand.blame, (arg?: unknown) => showCheckpointBlame(arg));
    registerCanonicalCommand(context, CheckpointCommand.hideBlame, () => hideCheckpointBlame());
    registerCanonicalCommand(context, CheckpointCommand.revealBlamed, (arg?: unknown) => revealBlamedCheckpoint(arg));
}
