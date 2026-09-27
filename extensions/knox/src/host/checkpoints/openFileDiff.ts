import * as vscode from 'vscode';

import { t } from '../i18n';

import { CheckpointManager } from './CheckpointManager';
import {
    CheckpointDiffContentProvider,
    CHECKPOINT_DIFF_SCHEME,
    diffResourceUris,
    workspaceFileUri,
} from './CheckpointTreeProvider';
import { selectCheckpointFileDiff } from './manager/fileDiffTarget';

let provider: CheckpointDiffContentProvider | undefined;
let registered = false;

export function registerCheckpointDiffContentProvider(context: vscode.ExtensionContext): void {
    if (registered) {
        return;
    }
    registered = true;
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(
            CHECKPOINT_DIFF_SCHEME,
            checkpointDiffProvider(),
        ),
    );
}

function checkpointDiffProvider(): CheckpointDiffContentProvider {
    if (!provider) {
        provider = new CheckpointDiffContentProvider();
    }
    return provider;
}

const DIFF_WARNING = {
    noSnapshots: 'checkpoint.diff.noSnapshots',
    noOriginalContent: 'checkpoint.diff.noOriginalContent',
} as const;

/**
 * Open one checkpoint file in the VS Code diff editor, beside the graph.
 * Errors are the inline-diff warnings already used when a blob is missing.
 */
export async function openCheckpointFileDiff(args: {
    checkpointId: string;
    relativePath: string;
    compareToCheckpointId?: string;
    compareToWorkspace?: boolean;
}): Promise<void> {
    const manager = CheckpointManager.getInstance();
    let diff = null;
    try {
        diff = args.compareToWorkspace
            ? await manager.computeCheckpointDiffAgainstWorkspace(args.checkpointId)
            : await manager.computeCheckpointDiff(args.checkpointId, args.compareToCheckpointId);
    } catch (error) {
        console.error('Checkpoint file diff failed:', error);
        vscode.window.showWarningMessage(t(DIFF_WARNING.noSnapshots));
        return;
    }

    const selected = selectCheckpointFileDiff(diff, args.relativePath);
    if (!selected.ok) {
        vscode.window.showWarningMessage(t(DIFF_WARNING[selected.error]));
        return;
    }
    if (!diff) {
        return;
    }

    const resource = diffResourceUris(
        checkpointDiffProvider(),
        diff,
        selected.file,
        manager.getCurrentWorkspacePath(),
    );
    await vscode.commands.executeCommand(
        'vscode.diff',
        resource.left,
        resource.right,
        resource.title,
        { viewColumn: vscode.ViewColumn.Beside, preview: true },
    );
}

function normalizedPath(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Open the stored text of one file at a checkpoint, beside the graph.
 * Binary snapshots stay closed; the same missing-blob warnings as the diff.
 */
export async function openCheckpointFileAtRevision(args: {
    checkpointId: string;
    relativePath: string;
}): Promise<void> {
    const manager = CheckpointManager.getInstance();
    let state = null;
    try {
        state = await manager.reconstructStateAtCheckpoint(args.checkpointId);
    } catch (error) {
        console.error('Checkpoint file at revision failed:', error);
        vscode.window.showWarningMessage(t(DIFF_WARNING.noSnapshots));
        return;
    }
    if (!state) {
        vscode.window.showWarningMessage(t(DIFF_WARNING.noSnapshots));
        return;
    }
    const wanted = normalizedPath(args.relativePath);
    let resolved: { content: string; encoding: string } | undefined;
    for (const [key, value] of state) {
        if (normalizedPath(key) === wanted) {
            resolved = value;
            break;
        }
    }
    if (!resolved) {
        vscode.window.showWarningMessage(t(DIFF_WARNING.noOriginalContent));
        return;
    }
    if (resolved.encoding === 'base64') {
        vscode.window.showWarningMessage(t('checkpoint.graph.binaryFile'));
        return;
    }
    const uri = checkpointDiffProvider().uriFor('right', args.checkpointId, wanted, resolved.content);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: true,
    });
}

/** Open the live workspace file beside the graph. */
export async function openCheckpointWorkingFile(relativePath: string): Promise<void> {
    const uri = workspaceFileUri(
        CheckpointManager.getInstance().getCurrentWorkspacePath(),
        relativePath,
    );
    if (!uri) {
        vscode.window.showWarningMessage(t(DIFF_WARNING.noOriginalContent));
        return;
    }
    try {
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document, {
            viewColumn: vscode.ViewColumn.Beside,
            preview: true,
        });
    } catch (error) {
        console.error('Open working file failed:', error);
        vscode.window.showWarningMessage(t(DIFF_WARNING.noOriginalContent));
    }
}
