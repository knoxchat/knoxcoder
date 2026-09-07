import * as vscode from 'vscode';

import { createKnoxLogger } from 'core/util/knoxLog';
import { t } from '../../i18n';

import { formatCheckpointAge } from './format';
import type { CheckpointEngineHost } from './host';
import { computeDiskStorageBytes } from './persistence';
import { previewRestore } from './restorePreview';
import { restoreCheckpoint } from './restore';
import type { CheckpointInfo } from './types';

const log = createKnoxLogger('Checkpoints');

export async function getCheckpointStatistics(host: CheckpointEngineHost): Promise<{
    totalCheckpoints: number;
    totalSessions: number;
    totalStorageBytes: number;
    avgCheckpointSize: number;
    filesTracked: number;
    oldestCheckpoint?: Date;
    newestCheckpoint?: Date;
}> {
    try {
        const totalCheckpoints = host.checkpointHistory.length;
        const totalStorageBytes = await computeDiskStorageBytes(host);
        const avgCheckpointSize = totalCheckpoints > 0
            ? Math.round(totalStorageBytes / totalCheckpoints)
            : 0;
        return {
            totalCheckpoints,
            totalSessions: 1,
            totalStorageBytes,
            avgCheckpointSize,
            filesTracked: host.recentlyModifiedFiles.size,
            oldestCheckpoint: totalCheckpoints > 0
                ? new Date(Math.min(...host.checkpointHistory.map((c) => c.created.getTime())))
                : undefined,
            newestCheckpoint: totalCheckpoints > 0
                ? new Date(Math.max(...host.checkpointHistory.map((c) => c.created.getTime())))
                : undefined,
        };
    } catch (error) {
        log.error('Failed to get checkpoint statistics:', error);
    }

    return {
        totalCheckpoints: host.checkpointHistory.length,
        totalSessions: 1,
        totalStorageBytes: 0,
        avgCheckpointSize: 0,
        filesTracked: 0,
    };
}

export {
    exportCheckpoints,
    importCheckpoints,
    type ExportCheckpointsOptions,
    type ImportCheckpointsOptions,
} from './bundleTransfer';

export async function restoreCheckpointWithConfirmation(
    host: CheckpointEngineHost,
    checkpoint: CheckpointInfo,
): Promise<void> {
    let counts = t('checkpoint.restorePreviewUnavailable');
    try {
        const preview = await previewRestore(host, checkpoint.id);
        if (preview) {
            counts = t('checkpoint.restorePreview', {
                modified: preview.modified,
                added: preview.added,
                deleted: preview.deleted,
            });
        }
    } catch (error) {
        log.debug('Failed to preview restore:', error);
    }

    const restoreAll = t('checkpoint.restoreAll');
    const action = await vscode.window.showWarningMessage(
        `${t('checkpoint.restoreQuestion', { description: checkpoint.description })}\n${counts}`,
        { modal: true },
        restoreAll,
        t('checkpoint.cancel'),
    );

    if (action !== restoreAll) {
        return;
    }

    try {
        const result = await restoreCheckpoint(host, checkpoint.id, {
            createBackup: true,
            conflictResolution: 'prompt',
        });

        if (result.success) {
            vscode.window.showInformationMessage(
                t('checkpoint.restoredSuccess', { count: result.restoredFiles.length }),
            );
        } else {
            vscode.window.showWarningMessage(
                t('checkpoint.restoredWithErrors', { count: result.failedFiles.length }),
            );
        }
    } catch (error) {
        log.error('Failed to restore checkpoint:', error);
        vscode.window.showErrorMessage(t('checkpoint.failedRestore', { error }));
    }
}

export async function showCheckpointList(host: CheckpointEngineHost): Promise<void> {
    if (!host.initialized) {
        vscode.window.showErrorMessage(t('checkpoint.systemNotInit'));
        return;
    }

    try {
        const checkpoints = host.checkpointHistory;

        if (checkpoints.length === 0) {
            vscode.window.showInformationMessage(t('checkpoint.noCheckpoints'));
            return;
        }

        const sortedCheckpoints = checkpoints.sort((a, b) => b.created.getTime() - a.created.getTime());

        const items = sortedCheckpoints.map((checkpoint: CheckpointInfo) => ({
            label: `$(history) ${checkpoint.description}`,
            description: formatCheckpointAge(checkpoint.created.toISOString()),
            detail: `ID: ${checkpoint.id.substring(0, 8)}...`,
            checkpoint,
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: t('checkpoint.chooseRestoreMethod'),
            matchOnDescription: true,
            matchOnDetail: true,
        });

        if (selected) {
            await restoreCheckpointWithConfirmation(host, selected.checkpoint);
        }
    } catch (error) {
        log.error('Failed to show checkpoint list:', error);
        vscode.window.showErrorMessage(t('checkpoint.failedShow', { error }));
    }
}
