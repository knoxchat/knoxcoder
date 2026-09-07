/**
 * Inline Diff Decorator for VS Code
 * 
 * Provides inline visualization of checkpoint differences directly in the editor:
 * - Gutter decorations showing changed lines
 * - Hover previews with original content
 * - Quick actions to restore individual lines/chunks
 * - CodeLens for checkpoint information
 */

import * as vscode from 'vscode';
import { t } from '../i18n';
import * as Diff from 'diff';
import * as path from 'path';
import { CheckpointManager } from './CheckpointManager';
import { CheckpointCommand, registerCanonicalCommand } from './commandIds';
import { INLINE_DIFF_DEFAULTS, readInlineDiffSettings } from './checkpointSettings';
import { computeInlineLineDiffs, type InlineLineDiff } from './inlineDiffLines';
import { toPosixRelative } from './manager/pathFilter';

export interface InlineDiffOptions {
    /** Show line-level decorations */
    showLineDecorations: boolean;
    /** Show gutter icons */
    showGutterIcons: boolean;
    /** Show hover previews */
    showHoverPreviews: boolean;
    /** Show CodeLens */
    showCodeLens: boolean;
    /** Highlight word-level changes */
    highlightWordChanges: boolean;
}

interface LineDiff extends InlineLineDiff {}

/**
 * Manages inline diff decorations in the editor
 */
export class InlineDiffDecorator implements vscode.Disposable {
    private static instance: InlineDiffDecorator | undefined;
    private static readonly INLINE_DIFF_CONTEXT_KEY = 'knoxCheckpointInlineDiffEnabled';
    private static readonly DIFF_LINES_CONTEXT_KEY = 'knoxCheckpointDiffLines';
    
    private disposables: vscode.Disposable[] = [];
    private checkpointManager: CheckpointManager;
    private options: InlineDiffOptions;
    
    // Decoration types
    private addedLineDecoration: vscode.TextEditorDecorationType;
    private removedLineDecoration: vscode.TextEditorDecorationType;
    private modifiedLineDecoration: vscode.TextEditorDecorationType;
    private addedGutterDecoration: vscode.TextEditorDecorationType;
    private removedGutterDecoration: vscode.TextEditorDecorationType;
    private modifiedGutterDecoration: vscode.TextEditorDecorationType;
    private wordAddedDecoration: vscode.TextEditorDecorationType;
    private wordRemovedDecoration: vscode.TextEditorDecorationType;
    
    // Current diff state
    private currentDiffs: Map<string, LineDiff[]> = new Map();
    private gutterRestoreTargets: Map<string, Map<number, number>> = new Map();
    private reconstructedContents = new Map<string, Map<string, string>>();
    private activeCheckpointId: string | null = null;
    private isEnabled: boolean = false;
    private applyingSetting = false;
    
    private constructor() {
        this.checkpointManager = CheckpointManager.getInstance();
        this.options = this.getDefaultOptions();
        
        // Create decoration types
        this.addedLineDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(34, 197, 94, 0.15)',
            isWholeLine: true,
            overviewRulerColor: '#22c55e',
            overviewRulerLane: vscode.OverviewRulerLane.Left,
        });
        
        this.removedLineDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            isWholeLine: true,
            overviewRulerColor: '#ef4444',
            overviewRulerLane: vscode.OverviewRulerLane.Left,
        });
        
        this.modifiedLineDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(59, 130, 246, 0.15)',
            isWholeLine: true,
            overviewRulerColor: '#3b82f6',
            overviewRulerLane: vscode.OverviewRulerLane.Left,
        });
        
        this.addedGutterDecoration = vscode.window.createTextEditorDecorationType({
            gutterIconPath: this.getGutterIcon('added'),
            gutterIconSize: 'contain',
        });
        
        this.removedGutterDecoration = vscode.window.createTextEditorDecorationType({
            gutterIconPath: this.getGutterIcon('removed'),
            gutterIconSize: 'contain',
        });
        
        this.modifiedGutterDecoration = vscode.window.createTextEditorDecorationType({
            gutterIconPath: this.getGutterIcon('modified'),
            gutterIconSize: 'contain',
        });
        
        this.wordAddedDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(34, 197, 94, 0.35)',
            borderRadius: '2px',
        });
        
        this.wordRemovedDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(239, 68, 68, 0.35)',
            borderRadius: '2px',
        });
    }
    
    static getInstance(): InlineDiffDecorator {
        if (!InlineDiffDecorator.instance) {
            InlineDiffDecorator.instance = new InlineDiffDecorator();
        }
        return InlineDiffDecorator.instance;
    }
    
    private getDefaultOptions(): InlineDiffOptions {
        return {
            showLineDecorations: INLINE_DIFF_DEFAULTS.showLineDecorations,
            showGutterIcons: INLINE_DIFF_DEFAULTS.showGutterIcons,
            showHoverPreviews: INLINE_DIFF_DEFAULTS.showHoverPreviews,
            showCodeLens: INLINE_DIFF_DEFAULTS.showCodeLens,
            highlightWordChanges: INLINE_DIFF_DEFAULTS.highlightWordChanges,
        };
    }
    
    /**
     * Get SVG path for gutter icon
     */
    private getGutterIcon(type: 'added' | 'removed' | 'modified'): vscode.Uri {
        const colors = {
            added: '#22c55e',
            removed: '#ef4444',
            modified: '#3b82f6',
        };
        
        const symbols = {
            added: 'M 4 6 L 8 6 M 6 4 L 6 8',
            removed: 'M 4 6 L 8 6',
            modified: 'M 6 3 L 6 9 M 4 6 L 8 6',
        };
        
        const svg = `
            <svg width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
                <circle cx="6" cy="6" r="5" fill="${colors[type]}20" stroke="${colors[type]}" stroke-width="1"/>
                <path d="${symbols[type]}" stroke="${colors[type]}" stroke-width="1.5" fill="none"/>
            </svg>
        `;
        
        return vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
    }
    
    /**
     * Initialize the inline diff decorator
     */
    initialize(context: vscode.ExtensionContext): void {
        // Load configuration
        this.loadConfiguration();
        
        // Listen for active editor changes
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor && this.isEnabled) {
                    void this.refreshDiffForEditor(editor);
                } else {
                    void this.syncActiveGutterContext();
                }
            })
        );
        
        // Listen for document changes
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                if (!this.isEnabled) {
                    return;
                }

                const editors = vscode.window.visibleTextEditors.filter(
                    editor => editor.document === event.document,
                );

                for (const editor of editors) {
                    void this.refreshDiffForEditor(editor);
                }
            })
        );
        
        // Listen for configuration changes
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('knox.checkpoints.inlineDiff')) {
                    this.loadConfiguration();
                    this.refreshAllDecorations();
                }
            })
        );
        
        // Register hover provider
        if (this.options.showHoverPreviews) {
            this.registerHoverProvider();
        }
        
        // Register CodeLens provider
        if (this.options.showCodeLens) {
            this.registerCodeLensProvider();
        }
        
        context.subscriptions.push(this);
        console.log('✅ Inline diff decorator initialized');
    }
    
    private loadConfiguration(): void {
        const settings = readInlineDiffSettings();
        this.options = {
            showLineDecorations: settings.showLineDecorations,
            showGutterIcons: settings.showGutterIcons,
            showHoverPreviews: settings.showHoverPreviews,
            showCodeLens: settings.showCodeLens,
            highlightWordChanges: settings.highlightWordChanges,
        };
        void this.applyEnabledSetting(settings.enabled);
    }

    private latestWorkspaceCheckpointId(): string | undefined {
        const checkpoints = this.checkpointManager.getCheckpointHistoryForWorkspace();
        if (checkpoints.length === 0) {
            return undefined;
        }
        return [...checkpoints].sort((a, b) => b.created.getTime() - a.created.getTime())[0]?.id;
    }

    private async applyEnabledSetting(enabled = readInlineDiffSettings().enabled): Promise<void> {
        if (this.applyingSetting) {
            return;
        }
        if (!enabled) {
            if (this.isEnabled) {
                this.disableDiffView({ persist: false });
            }
            return;
        }
        const checkpointId = this.activeCheckpointId ?? this.latestWorkspaceCheckpointId();
        if (!checkpointId) {
            return;
        }
        await this.enableDiffView(checkpointId, { persist: false });
    }
    
    /**
     * Enable inline diff view against a checkpoint
     */
    async enableDiffView(
        checkpointId: string,
        options?: { persist?: boolean },
    ): Promise<void> {
        this.activeCheckpointId = checkpointId;
        this.isEnabled = true;
        this.reconstructedContents.delete(checkpointId);

        const contents = await this.loadReconstructedContents(checkpointId);
        if (contents.size === 0) {
            vscode.window.showWarningMessage(t('checkpoint.diff.noSnapshots'));
            return;
        }

        this.currentDiffs.clear();

        const editor = vscode.window.activeTextEditor;
        if (editor) {
            await this.refreshDiffForEditor(editor);
        } else {
            await this.syncActiveGutterContext();
        }

        if (options?.persist !== false) {
            await this.persistEnabled(true);
            vscode.window.showInformationMessage(
                t('checkpoint.diff.showingDiff', { id: checkpointId.substring(0, 8) })
            );
        }
    }

    /**
     * Disable inline diff view
     */
    disableDiffView(options?: { persist?: boolean }): void {
        this.isEnabled = false;
        this.activeCheckpointId = null;
        this.currentDiffs.clear();
        this.gutterRestoreTargets.clear();
        this.reconstructedContents.clear();
        this.clearAllDecorations();
        void this.syncActiveGutterContext();
        if (options?.persist !== false) {
            void this.persistEnabled(false);
        }
    }

    private async persistEnabled(enabled: boolean): Promise<void> {
        this.applyingSetting = true;
        try {
            await vscode.workspace.getConfiguration('knox.checkpoints.inlineDiff').update(
                'enabled',
                enabled,
                vscode.ConfigurationTarget.Global,
            );
        } finally {
            this.applyingSetting = false;
        }
    }

    private async loadReconstructedContents(checkpointId: string): Promise<Map<string, string>> {
        const cached = this.reconstructedContents.get(checkpointId);
        if (cached) {
            return cached;
        }
        const state = await this.checkpointManager.reconstructStateAtCheckpoint(checkpointId);
        const contents = new Map<string, string>();
        if (state) {
            for (const [relativePath, file] of state) {
                contents.set(toPosixRelative(relativePath), file.content);
            }
        }
        this.reconstructedContents.set(checkpointId, contents);
        return contents;
    }

    private getRelativePathForUri(uri: vscode.Uri): string | null {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            return null;
        }

        return toPosixRelative(path.relative(workspaceFolder.uri.fsPath, uri.fsPath));
    }

    private getActiveCheckpointContent(relativePath: string): string | undefined {
        if (!this.activeCheckpointId) {
            return undefined;
        }
        const contents = this.reconstructedContents.get(this.activeCheckpointId);
        return contents?.get(toPosixRelative(relativePath));
    }

    private async refreshDiffForEditor(editor: vscode.TextEditor): Promise<void> {
        const relativePath = this.getRelativePathForUri(editor.document.uri);
        if (!relativePath || !this.isEnabled) {
            if (relativePath) {
                this.currentDiffs.delete(relativePath);
                this.gutterRestoreTargets.delete(relativePath);
            }
            this.clearDecorations(editor);
            if (editor === vscode.window.activeTextEditor) {
                await this.syncActiveGutterContext();
            }
            return;
        }

        const originalContent = this.getActiveCheckpointContent(relativePath);
        if (originalContent === undefined) {
            this.currentDiffs.delete(relativePath);
            this.gutterRestoreTargets.delete(relativePath);
            this.clearDecorations(editor);
            if (editor === vscode.window.activeTextEditor) {
                await this.syncActiveGutterContext();
            }
            return;
        }

        const diffs = this.computeFileDiff(originalContent, editor.document.getText());
        if (diffs.length > 0) {
            this.currentDiffs.set(relativePath, diffs);
        } else {
            this.currentDiffs.delete(relativePath);
        }

        this.updateDecorations(editor);

        if (editor === vscode.window.activeTextEditor) {
            await this.syncActiveGutterContext();
        }
    }

    private async syncActiveGutterContext(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        const relativePath = editor ? this.getRelativePathForUri(editor.document.uri) : null;
        const diffLines = relativePath
            ? Array.from(this.gutterRestoreTargets.get(relativePath)?.keys() ?? []).sort((a, b) => a - b)
            : [];

        await vscode.commands.executeCommand(
            'setContext',
            InlineDiffDecorator.INLINE_DIFF_CONTEXT_KEY,
            this.isEnabled && diffLines.length > 0,
        );
        await vscode.commands.executeCommand(
            'setContext',
            InlineDiffDecorator.DIFF_LINES_CONTEXT_KEY,
            diffLines,
        );
    }

    private getDisplayLineNumber(document: vscode.TextDocument, diff: LineDiff): number {
        if (document.lineCount <= 0) {
            return 0;
        }

        return Math.min(diff.lineNumber, document.lineCount - 1);
    }

    private getLineDeletionRange(document: vscode.TextDocument, lineNumber: number): vscode.Range {
        const line = document.lineAt(lineNumber);

        if (lineNumber < document.lineCount - 1) {
            return new vscode.Range(line.range.start, document.lineAt(lineNumber + 1).range.start);
        }

        if (lineNumber > 0) {
            return new vscode.Range(document.lineAt(lineNumber - 1).range.end, line.range.end);
        }

        return line.range;
    }
    
    /**
     * Compute diff for a single file
     */
    private computeFileDiff(originalContent: string, currentText: string): LineDiff[] {
        return computeInlineLineDiffs(
            originalContent,
            currentText,
            Diff.diffLines,
            Diff.diffWords,
        );
    }
    
    /**
     * Update decorations for an editor
     */
    private updateDecorations(editor: vscode.TextEditor): void {
        if (!this.isEnabled) {
            const relativePath = this.getRelativePathForUri(editor.document.uri);
            if (relativePath) {
                this.gutterRestoreTargets.delete(relativePath);
            }
            this.clearDecorations(editor);
            return;
        }
        
        const relativePath = this.getRelativePathForUri(editor.document.uri);
        if (!relativePath) return;
        
        const diffs = this.currentDiffs.get(relativePath);
        if (!diffs) {
            this.gutterRestoreTargets.delete(relativePath);
            this.clearDecorations(editor);
            return;
        }
        
        const addedRanges: vscode.DecorationOptions[] = [];
        const removedRanges: vscode.DecorationOptions[] = [];
        const modifiedRanges: vscode.DecorationOptions[] = [];
        const wordAddedRanges: vscode.DecorationOptions[] = [];
        const gutterRestoreTargets = new Map<number, number>();
        
        for (const diff of diffs) {
            const displayLineNumber = this.getDisplayLineNumber(editor.document, diff);
            if (displayLineNumber >= editor.document.lineCount) {
                continue;
            }

            const line = editor.document.lineAt(displayLineNumber);
            const range = line.range;
            const gutterLineNumber = displayLineNumber + 1;

            if (!gutterRestoreTargets.has(gutterLineNumber)) {
                gutterRestoreTargets.set(gutterLineNumber, diff.lineNumber);
            }
            
            const decoration: vscode.DecorationOptions = {
                range,
                hoverMessage: this.createHoverMessage(diff),
            };
            
            switch (diff.type) {
                case 'added':
                    addedRanges.push(decoration);
                    break;
                case 'removed':
                    removedRanges.push(decoration);
                    break;
                case 'modified':
                    modifiedRanges.push(decoration);
                    // Add word-level highlights for modified lines
                    if (this.options.highlightWordChanges && diff.wordChanges) {
                        for (const wc of diff.wordChanges) {
                            if (wc.type === 'added') {
                                wordAddedRanges.push({
                                    range: new vscode.Range(
                                        diff.lineNumber, wc.start,
                                        diff.lineNumber, wc.end
                                    ),
                                });
                            }
                        }
                    }
                    break;
            }
        }
        
        // Apply decorations
        if (this.options.showLineDecorations) {
            editor.setDecorations(this.addedLineDecoration, addedRanges);
            editor.setDecorations(this.removedLineDecoration, removedRanges);
            editor.setDecorations(this.modifiedLineDecoration, modifiedRanges);
        }
        
        // Apply word-level decorations
        if (this.options.highlightWordChanges) {
            editor.setDecorations(this.wordAddedDecoration, wordAddedRanges);
        }
        
        if (this.options.showGutterIcons) {
            editor.setDecorations(this.addedGutterDecoration, addedRanges);
            editor.setDecorations(this.removedGutterDecoration, removedRanges);
            editor.setDecorations(this.modifiedGutterDecoration, modifiedRanges);
        }

        this.gutterRestoreTargets.set(relativePath, gutterRestoreTargets);
    }
    
    /**
     * Create hover message for a diff
     */
    private createHoverMessage(diff: LineDiff): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.supportHtml = true;
        
        switch (diff.type) {
            case 'added':
                md.appendMarkdown(`**Added line**\n\n`);
                md.appendMarkdown(`\`\`\`\n${diff.currentContent}\n\`\`\``);
                break;
                
            case 'removed':
                md.appendMarkdown(`**Removed line** (was:)\n\n`);
                md.appendMarkdown(`\`\`\`diff\n- ${diff.originalContent}\n\`\`\``);
                break;
                
            case 'modified':
                md.appendMarkdown(`**Modified line**\n\n`);
                md.appendMarkdown(`Original:\n\`\`\`diff\n- ${diff.originalContent}\n\`\`\`\n\n`);
                md.appendMarkdown(`Current:\n\`\`\`diff\n+ ${diff.currentContent}\n\`\`\``);
                break;
        }
        
        // Add action links
        md.appendMarkdown(`\n\n---\n`);
        md.appendMarkdown(`[Restore line](command:${CheckpointCommand.restoreLine}?${encodeURIComponent(JSON.stringify({ lineNumber: diff.lineNumber }))}) | `);
        md.appendMarkdown(`[View full diff](command:${CheckpointCommand.viewFileDiff})`);
        
        return md;
    }
    
    /**
     * Clear decorations for an editor
     */
    private clearDecorations(editor: vscode.TextEditor): void {
        editor.setDecorations(this.addedLineDecoration, []);
        editor.setDecorations(this.removedLineDecoration, []);
        editor.setDecorations(this.modifiedLineDecoration, []);
        editor.setDecorations(this.addedGutterDecoration, []);
        editor.setDecorations(this.removedGutterDecoration, []);
        editor.setDecorations(this.modifiedGutterDecoration, []);
        editor.setDecorations(this.wordAddedDecoration, []);
        editor.setDecorations(this.wordRemovedDecoration, []);
    }
    
    /**
     * Clear all decorations
     */
    private clearAllDecorations(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            this.clearDecorations(editor);
        }
    }
    
    /**
     * Refresh decorations for all visible editors
     */
    private refreshAllDecorations(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            this.updateDecorations(editor);
        }
    }
    
    /**
     * Register hover provider for detailed diff information
     */
    private registerHoverProvider(): void {
        const provider = vscode.languages.registerHoverProvider(
            { scheme: 'file' },
            {
                provideHover: (document, position) => {
                    if (!this.isEnabled) return null;
                    
                    const relativePath = this.getRelativePathForUri(document.uri);
                    if (!relativePath) return null;
                    
                    const diffs = this.currentDiffs.get(relativePath);
                    if (!diffs) return null;
                    
                    const diff = diffs.find(d => d.lineNumber === position.line);
                    if (!diff) return null;
                    
                    return new vscode.Hover(this.createHoverMessage(diff));
                }
            }
        );
        
        this.disposables.push(provider);
    }
    
    /**
     * Register CodeLens provider for checkpoint information
     */
    private registerCodeLensProvider(): void {
        const provider = vscode.languages.registerCodeLensProvider(
            { scheme: 'file' },
            {
                provideCodeLenses: (document) => {
                    if (!this.isEnabled) return [];
                    
                    const relativePath = this.getRelativePathForUri(document.uri);
                    if (!relativePath) return [];
                    
                    const diffs = this.currentDiffs.get(relativePath);
                    if (!diffs || diffs.length === 0) return [];
                    
                    // Add CodeLens at the top of the file
                    const topRange = new vscode.Range(0, 0, 0, 0);
                    
                    const addedCount = diffs.filter(d => d.type === 'added').length;
                    const removedCount = diffs.filter(d => d.type === 'removed').length;
                    const modifiedCount = diffs.filter(d => d.type === 'modified').length;
                    
                    const summary = [
                        addedCount > 0 ? `+${addedCount}` : '',
                        removedCount > 0 ? `-${removedCount}` : '',
                        modifiedCount > 0 ? `~${modifiedCount}` : '',
                    ].filter(Boolean).join(' ');
                    
                    return [
                        new vscode.CodeLens(topRange, {
                            title: `📊 Checkpoint diff: ${summary} lines`,
                            command: CheckpointCommand.viewFileDiff,
                            arguments: [this.activeCheckpointId, relativePath],
                        }),
                        new vscode.CodeLens(topRange, {
                            title: '✖ Hide diff',
                            command: CheckpointCommand.hideDiff,
                        }),
                        // Per-block "Restore this block" lenses
                        ...this.buildBlockCodeLenses(diffs, document.uri),
                    ];
                }
            }
        );
        
        this.disposables.push(provider);
    }

    /**
     * Build per-block "Restore this block" CodeLens items by grouping consecutive diffs
     */
    private buildBlockCodeLenses(diffs: LineDiff[], uri: vscode.Uri): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];
        if (diffs.length === 0) return lenses;

        // Group consecutive line diffs into blocks
        const sorted = [...diffs].sort((a, b) => a.lineNumber - b.lineNumber);
        let blockStart = sorted[0].lineNumber;
        let blockEnd = sorted[0].lineNumber;
        const blocks: Array<{ start: number; end: number; count: number }> = [];

        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i].lineNumber <= blockEnd + 2) {
                // Adjacent or close enough — extend block
                blockEnd = sorted[i].lineNumber;
            } else {
                blocks.push({ start: blockStart, end: blockEnd, count: blockEnd - blockStart + 1 });
                blockStart = sorted[i].lineNumber;
                blockEnd = sorted[i].lineNumber;
            }
        }
        blocks.push({ start: blockStart, end: blockEnd, count: blockEnd - blockStart + 1 });

        for (const block of blocks) {
            const range = new vscode.Range(block.start, 0, block.start, 0);
            lenses.push(
                new vscode.CodeLens(range, {
                    title: `↩ Restore block (${block.count} line${block.count > 1 ? 's' : ''})`,
                    command: CheckpointCommand.restoreBlock,
                    arguments: [uri, block.start, block.end],
                }),
            );
        }

        return lenses;
    }
    
    /**
     * Restore a single line from checkpoint
     */
    async restoreLine(lineNumber: number): Promise<void> {
        const activeUri = vscode.window.activeTextEditor?.document.uri;
        if (!activeUri) {
            return;
        }

        await this.restoreLineAtUri(activeUri, lineNumber);
    }

    async restoreLineFromGutter(uri: vscode.Uri, lineNumber: number): Promise<void> {
        const relativePath = this.getRelativePathForUri(uri);
        const targetLineNumber = relativePath
            ? this.gutterRestoreTargets.get(relativePath)?.get(lineNumber)
            : undefined;

        await this.restoreLineAtUri(uri, targetLineNumber ?? Math.max(lineNumber - 1, 0));
    }

    async restoreLineAtUri(uri: vscode.Uri, lineNumber: number): Promise<void> {
        const relativePath = this.getRelativePathForUri(uri);
        if (!relativePath) {
            return;
        }

        const document = await vscode.workspace.openTextDocument(uri);
        let editor = vscode.window.visibleTextEditors.find(
            visibleEditor => visibleEditor.document.uri.toString() === uri.toString(),
        );

        if (!editor) {
            editor = await vscode.window.showTextDocument(document, { preview: false });
        }

        const diffs = this.currentDiffs.get(relativePath);
        const diff = diffs?.find(d => d.lineNumber === lineNumber);

        if (!diff) {
            vscode.window.showWarningMessage(t('checkpoint.diff.noOriginalContent'));
            return;
        }

        const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
        const editApplied = await editor.edit(editBuilder => {
            switch (diff.type) {
                case 'added': {
                    if (lineNumber < document.lineCount) {
                        editBuilder.delete(this.getLineDeletionRange(document, lineNumber));
                    }
                    break;
                }
                case 'modified': {
                    if (lineNumber >= document.lineCount || diff.originalContent === undefined) {
                        return;
                    }

                    editBuilder.replace(document.lineAt(lineNumber).range, diff.originalContent);
                    break;
                }
                case 'removed': {
                    if (diff.originalContent === undefined) {
                        return;
                    }

                    if (document.lineCount === 1 && document.lineAt(0).text === '' && lineNumber === 0) {
                        editBuilder.replace(document.lineAt(0).range, diff.originalContent);
                    } else if (lineNumber >= document.lineCount) {
                        const insertionPoint = document.lineAt(document.lineCount - 1).range.end;
                        editBuilder.insert(insertionPoint, `${eol}${diff.originalContent}`);
                    } else {
                        editBuilder.insert(new vscode.Position(lineNumber, 0), `${diff.originalContent}${eol}`);
                    }
                    break;
                }
            }
        });

        if (!editApplied) {
            vscode.window.showWarningMessage(t('checkpoint.failedRestore', { error: 'edit rejected' }));
            return;
        }

        await this.refreshDiffForEditor(editor);

        vscode.window.showInformationMessage(t('checkpoint.diff.lineRestored'));
    }
    
    /**
     * Get current diff statistics
     */
    getDiffStats(): { added: number; removed: number; modified: number; filesChanged: number } {
        let added = 0;
        let removed = 0;
        let modified = 0;
        let filesChanged = 0;
        
        for (const [, diffs] of this.currentDiffs) {
            if (diffs.length > 0) {
                filesChanged++;
                for (const diff of diffs) {
                    switch (diff.type) {
                        case 'added': added++; break;
                        case 'removed': removed++; break;
                        case 'modified': modified++; break;
                    }
                }
            }
        }
        
        return { added, removed, modified, filesChanged };
    }
    
    /**
     * Check if diff view is enabled
     */
    isViewEnabled(): boolean {
        return this.isEnabled;
    }
    
    /**
     * Get active checkpoint ID
     */
    getActiveCheckpointId(): string | null {
        return this.activeCheckpointId;
    }
    
    /**
     * Dispose resources
     */
    dispose(): void {
        this.clearAllDecorations();
        
        this.addedLineDecoration.dispose();
        this.removedLineDecoration.dispose();
        this.modifiedLineDecoration.dispose();
        this.addedGutterDecoration.dispose();
        this.removedGutterDecoration.dispose();
        this.modifiedGutterDecoration.dispose();
        this.wordAddedDecoration.dispose();
        this.wordRemovedDecoration.dispose();
        
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        
        this.disposables = [];
    }
}

/**
 * Register inline diff commands
 */
export function registerInlineDiffCommands(context: vscode.ExtensionContext): void {
    const decorator = InlineDiffDecorator.getInstance();
    decorator.initialize(context);

    registerCanonicalCommand(context, CheckpointCommand.showInlineDiff, async (checkpointId?: string) => {
        if (!checkpointId) {
            const checkpointManager = CheckpointManager.getInstance();
            const checkpoints = checkpointManager.getCheckpointHistoryForWorkspace();

            const items = checkpoints.map(cp => ({
                label: cp.description,
                description: cp.id.substring(0, 8),
                detail: cp.created.toLocaleString(),
                checkpointId: cp.id,
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: t('checkpoint.diff.selectCompare'),
            });

            if (!selected) return;
            checkpointId = selected.checkpointId;
        }

        await decorator.enableDiffView(checkpointId);
    });

    registerCanonicalCommand(context, CheckpointCommand.hideDiff, () => {
        decorator.disableDiffView();
        vscode.window.showInformationMessage(t('checkpoint.diff.viewDisabled'));
    });

    registerCanonicalCommand(context, CheckpointCommand.restoreLine, async (args: { lineNumber: number }) => {
        await decorator.restoreLine(args.lineNumber);
    });

    registerCanonicalCommand(context, CheckpointCommand.restoreLineFromGutter, async (uri: vscode.Uri, lineNumber?: number) => {
        if (lineNumber === undefined) {
            const activeLine = vscode.window.activeTextEditor?.selection.active.line;
            if (activeLine === undefined) {
                return;
            }
            await decorator.restoreLine(activeLine);
            return;
        }

        await decorator.restoreLineFromGutter(uri, lineNumber);
    });

    registerCanonicalCommand(context, CheckpointCommand.viewFileDiff, (_checkpointId?: string, _filePath?: string) => {
        vscode.commands.executeCommand('knoxchat.openRestorePage');
    });

    registerCanonicalCommand(context, CheckpointCommand.restoreBlock, async (uri: vscode.Uri, startLine: number, endLine: number) => {
        const instance = InlineDiffDecorator.getInstance();
        if (!instance) return;
        for (let line = startLine; line <= endLine; line++) {
            await instance.restoreLineAtUri(uri, line);
        }
    });
}
