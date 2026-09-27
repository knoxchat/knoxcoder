import * as fs from 'fs';
import * as path from 'path';

import * as vscode from 'vscode';

import { createKnoxLogger } from 'core/util/knoxLog';
import { t } from '../../i18n';
import { lineageCheckpoints } from './branchLogic';
import {
    replaySnapshotsToState,
    ResolvedFileState,
    ReplayCheckpoint,
} from '../checkpointReplay';
import {
    captureCompleteFileInventory,
} from './capture';
import { bytesFromSnapshotContent, getBlob, hashBlobBytes } from '../store/blobStore';
import { BlobEncryptionError } from '../store/blobEncryption';
import { readBlobOptions } from './blobCrypto';
import type { CheckpointEngineHost } from './host';
import { getStoragePath, recordHealthIssue } from './persistence';
import {
    clearRestoreJournal,
    readRestoreJournal,
    removeRestoreTempFile,
    replaceWithRestoreTemp,
    restoreTempPath,
    writeRestoreJournal,
    type RestoreJournal,
} from './restoreJournal';
import type {
    FileSnapshot,
    RestoreCheckpointOptions,
    RestoreCheckpointResult,
    RestoreFilesResult,
} from './types';
import { getCheckpointHistoryForWorkspace, resolveWorkspaceRelativePath } from './workspace';

const log = createKnoxLogger('Checkpoints');

function sandboxEscapeError(relativePath: string): string {
    return t('checkpoint.error.sandbox', { path: relativePath });
}

export async function reconstructStateAtCheckpoint(
    host: CheckpointEngineHost,
    checkpointId: string,
): Promise<Map<string, ResolvedFileState> | null> {
    const history = getCheckpointHistoryForWorkspace(
        host.checkpointHistory,
        host.currentWorkspacePath,
    );
    const chainInfos = lineageCheckpoints(history, checkpointId);
    if (!chainInfos) {
        return null;
    }

    const chain: ReplayCheckpoint[] = [];
    for (const info of chainInfos) {
        const fromDisk = await host.loadCheckpointFromDisk(info.id);
        if (!fromDisk && host.lastCheckpointLoad?.status === 'corrupt') {
            return null;
        }
        chain.push({ fileSnapshots: fromDisk?.fileSnapshots || [] });
    }
    return replaySnapshotsToState(chain);
}

export async function writeSnapshotContent(
    host: CheckpointEngineHost,
    snapshot: FileSnapshot,
): Promise<void> {
    const sandboxed = resolveWorkspaceRelativePath(host, snapshot.relativePath);
    if (!sandboxed.ok) {
        throw new Error(sandboxEscapeError(snapshot.relativePath));
    }
    const targetPath = sandboxed.fullPath;
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    const tempPath = restoreTempPath(targetPath);
    try {
        let bytes: Buffer;
        if (snapshot.hash) {
            bytes = await getBlob(getStoragePath(host), snapshot.hash, await readBlobOptions(host));
        } else if (snapshot.content != null) {
            bytes = bytesFromSnapshotContent(snapshot.content, snapshot.encoding || 'utf8');
        } else {
            throw new Error(`Snapshot for ${snapshot.relativePath} has no blob hash or content`);
        }
        await fs.promises.writeFile(tempPath, bytes);
        await replaceWithRestoreTemp(tempPath, targetPath);
    } catch (error) {
        await removeRestoreTempFile(targetPath);
        throw error;
    }
}

export async function removeEmptyDirectories(
    host: CheckpointEngineHost,
    dirPath: string,
): Promise<void> {
    if (!host.currentWorkspacePath || !dirPath.startsWith(host.currentWorkspacePath)) {
        return;
    }

    try {
        const entries = await fs.promises.readdir(dirPath);
        if (entries.length === 0) {
            await fs.promises.rmdir(dirPath);
            log.info(`Removed empty directory: ${path.relative(host.currentWorkspacePath, dirPath)}`);

            const parentDir = path.dirname(dirPath);
            if (parentDir !== host.currentWorkspacePath && parentDir !== dirPath) {
                await removeEmptyDirectories(host, parentDir);
            }
        }
    } catch (error) {
        log.debug(`Could not remove directory ${dirPath}:`, error instanceof Error ? error.message : String(error));
    }
}

export async function getCurrentWorkspaceFiles(host: CheckpointEngineHost): Promise<string[]> {
    if (!host.currentWorkspacePath) {
        return [];
    }

    try {
        return await captureCompleteFileInventory(host);
    } catch (error) {
        log.error('Failed to get current workspace files:', error);
        return [];
    }
}

export async function cleanupFilesNotInInventory(
    host: CheckpointEngineHost,
    fileInventory: string[],
    removedFiles: string[],
    failedFiles: Array<{ path: string; error: string }>,
): Promise<void> {
    if (!host.currentWorkspacePath) {
        return;
    }

    try {
        const inventorySet = new Set(fileInventory);
        const currentFiles = await captureCompleteFileInventory(host);
        const filesToRemove = currentFiles.filter((file) => !inventorySet.has(file));

        if (filesToRemove.length === 0) {
            log.info('✅ No extra files to remove');
            return;
        }

        log.info(`🗑️ Removing ${filesToRemove.length} files not in checkpoint inventory`);

        for (const relativePath of filesToRemove) {
            try {
                const sandboxed = resolveWorkspaceRelativePath(host, relativePath);
                if (!sandboxed.ok) {
                    failedFiles.push({
                        path: relativePath,
                        error: sandboxEscapeError(relativePath),
                    });
                    continue;
                }
                await fs.promises.unlink(sandboxed.fullPath);
                removedFiles.push(relativePath);
                log.info(`   Removed: ${relativePath}`);
                await removeEmptyDirectories(host, path.dirname(sandboxed.fullPath));
            } catch (error) {
                failedFiles.push({
                    path: relativePath,
                    error: `Failed to remove: ${error instanceof Error ? error.message : String(error)}`,
                });
            }
        }

        log.info(`✅ Cleaned up ${removedFiles.length} extra files`);
    } catch (error) {
        log.error('Failed to cleanup files not in inventory:', error);
    }
}

export async function cleanupExtraFiles(
    host: CheckpointEngineHost,
    checkpointFiles: FileSnapshot[],
    removedFiles: string[],
    failedFiles: Array<{ path: string; error: string }>,
    options?: RestoreCheckpointOptions,
): Promise<void> {
    if (!host.currentWorkspacePath) {
        return;
    }

    try {
        const currentFiles = await getCurrentWorkspaceFiles(host);
        const checkpointFilePaths = new Set(checkpointFiles.map((f) => f.relativePath));
        const extraFiles = currentFiles.filter((filePath) => !checkpointFilePaths.has(filePath));

        if (extraFiles.length === 0) {
            return;
        }

        if (options?.conflictResolution === 'prompt' && extraFiles.length > 0) {
            const choice = await vscode.window.showWarningMessage(
                t('checkpoint.filesNotInCheckpoint', { count: extraFiles.length }),
                { modal: true },
                t('checkpoint.yesRemoveAll'),
                t('checkpoint.noKeepFiles'),
                t('checkpoint.showFiles'),
            );

            if (choice === t('checkpoint.showFiles')) {
                const fileList = extraFiles.slice(0, 10).join('\n') +
                    (extraFiles.length > 10 ? `\n... and ${extraFiles.length - 10} more` : '');

                const confirmChoice = await vscode.window.showWarningMessage(
                    t('checkpoint.filesToBeRemoved', { fileList }),
                    { modal: true },
                    t('checkpoint.yesRemoveAll'),
                    t('checkpoint.noKeepFiles'),
                );

                if (confirmChoice !== t('checkpoint.yesRemoveAll')) {
                    return;
                }
            } else if (choice !== t('checkpoint.yesRemoveAll')) {
                return;
            }
        }

        for (const filePath of extraFiles) {
            try {
                const sandboxed = resolveWorkspaceRelativePath(host, filePath);
                if (!sandboxed.ok) {
                    failedFiles.push({
                        path: filePath,
                        error: sandboxEscapeError(filePath),
                    });
                    continue;
                }
                await fs.promises.unlink(sandboxed.fullPath);
                removedFiles.push(filePath);
                await removeEmptyDirectories(host, path.dirname(sandboxed.fullPath));
            } catch (error) {
                failedFiles.push({
                    path: filePath,
                    error: `Failed to remove: ${error instanceof Error ? error.message : String(error)}`,
                });
            }
        }
    } catch (error) {
        log.error('Failed to cleanup extra files:', error);
    }
}

export interface RestoreTestHooks {
    beforeWrite?: (relativePath: string, index: number) => Promise<void> | void;
    shouldCancel?: (relativePath: string, index: number) => boolean;
}

let restoreTestHooks: RestoreTestHooks | undefined;

export function setRestoreTestHooks(hooks?: RestoreTestHooks): void {
    restoreTestHooks = hooks;
}

export async function recoverIncompleteRestore(host: CheckpointEngineHost): Promise<void> {
    const journal = await readRestoreJournal(host);
    if (!journal) {
        return;
    }

    log.warn(`Incomplete restore journal found for ${journal.checkpointId}; recovering`);
    recordHealthIssue(host, {
        kind: 'restore_incomplete',
        checkpointId: journal.checkpointId,
        message: `Incomplete restore of ${journal.checkpointId}`,
    });

    journal.status = 'rolling_back';
    await writeRestoreJournal(host, journal);

    if (journal.backupCheckpointId) {
        try {
            await restoreCheckpoint(host, journal.backupCheckpointId, {
                createBackup: false,
                skipJournal: true,
                conflictResolution: 'overwrite',
                cleanupExtraFiles: false,
            });
        } catch (error) {
            log.error('Failed to roll back incomplete restore from backup checkpoint:', error);
            return;
        }
    }

    for (const relativePath of journal.plannedWrites) {
        const sandboxed = resolveWorkspaceRelativePath(host, relativePath);
        if (sandboxed.ok) {
            await removeRestoreTempFile(sandboxed.fullPath);
        }
    }

    await clearRestoreJournal(host);
    log.info(`Recovered incomplete restore for ${journal.checkpointId}`);
}

function encryptionFailureMessage(error: BlobEncryptionError): string {
    return error.code === 'missing_key'
        ? t('checkpoint.encrypt.missingKey')
        : t('checkpoint.encrypt.decryptFailed');
}

export async function restoreCheckpoint(
    host: CheckpointEngineHost,
    checkpointId: string,
    options?: RestoreCheckpointOptions,
): Promise<RestoreCheckpointResult> {
    const restoreStartedAt = Date.now();

    if (!host.initialized) {
        throw new Error('Checkpoint system not initialized');
    }

    const checkpoint = host.checkpointHistory.find((c) => c.id === checkpointId);
    if (!checkpoint) {
        throw new Error(`Checkpoint ${checkpointId} not found`);
    }

    try {
        const checkpointData = await host.loadCheckpointFromDisk(checkpointId);
        if (!checkpointData) {
            if (host.lastCheckpointLoad?.status === 'corrupt') {
                throw new Error(
                    t('checkpoint.corrupt', {
                        id: checkpointId,
                        reason: host.lastCheckpointLoad.reason,
                    }),
                );
            }
            throw new Error(t('checkpoint.dataNotFound', { id: checkpointId }));
        }

        const stateAtCheckpoint = await reconstructStateAtCheckpoint(host, checkpointId);
        if (!stateAtCheckpoint) {
            throw new Error(t('checkpoint.error.reconstruct', { id: checkpointId }));
        }

        const restoredFiles: string[] = [];
        const failedFiles: Array<{ path: string; error: string }> = [];
        const conflicts: Array<{ path: string; type: string }> = [];
        const removedFiles: string[] = [];
        let cancelled = false;
        let backupCheckpointId: string | undefined;
        let journal: RestoreJournal | undefined;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: t('checkpoint.restoreProgress.title'),
            cancellable: true,
        }, async (progress, token) => {
            progress.report({ increment: 0, message: t('checkpoint.restoreProgress.preparing') });

            if (options?.createBackup !== false) {
                progress.report({ increment: 10, message: t('checkpoint.restoreProgress.backup') });
                backupCheckpointId = await host.createManualCheckpoint({
                    description: `Pre-restore backup for ${checkpointId}`,
                    allowEmpty: true,
                    forceBaseline: true,
                });
            }

            const entries = Array.from(stateAtCheckpoint.entries()).filter(([relativePath]) => {
                if (options?.includeFiles && !options.includeFiles.includes(relativePath)) {
                    return false;
                }
                if (options?.excludeFiles?.includes(relativePath)) {
                    return false;
                }
                return true;
            });
            const plannedWrites = entries.map(([relativePath]) => relativePath);

            if (!options?.skipJournal) {
                journal = {
                    schemaVersion: 1,
                    checkpointId,
                    backupCheckpointId,
                    startedAt: new Date().toISOString(),
                    plannedWrites,
                    plannedDeletes: checkpointData.fileInventory ?? [],
                    completedWrites: [],
                    status: 'writing',
                };
                await writeRestoreJournal(host, journal);
            }

            progress.report({ increment: 20, message: t('checkpoint.restoreProgress.files') });

            const totalFiles = Math.max(entries.length, 1);
            let processedFiles = 0;

            for (const [relativePath, resolved] of entries) {
                if (
                    token.isCancellationRequested
                    || restoreTestHooks?.shouldCancel?.(relativePath, processedFiles)
                ) {
                    cancelled = true;
                    failedFiles.push({ path: relativePath, error: 'cancelled' });
                    break;
                }

                try {
                    const sandboxed = resolveWorkspaceRelativePath(host, relativePath);
                    if (!sandboxed.ok) {
                        failedFiles.push({
                            path: relativePath,
                            error: sandboxEscapeError(relativePath),
                        });
                        continue;
                    }
                    const fullPath = sandboxed.fullPath;
                    const snapshot: FileSnapshot = {
                        relativePath,
                        content: resolved.content,
                        hash: resolved.hash,
                        encoding: resolved.encoding,
                        lastModified: new Date(),
                        size: resolved.content.length,
                    };

                    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });

                    let shouldRestore = true;
                    try {
                        const currentBuffer = await fs.promises.readFile(fullPath);
                        const sameBytes = snapshot.hash
                            ? hashBlobBytes(currentBuffer) === snapshot.hash
                            : snapshot.content != null
                                && bytesFromSnapshotContent(
                                    snapshot.content,
                                    snapshot.encoding || 'utf8',
                                ).equals(currentBuffer);

                        if (!sameBytes) {
                            conflicts.push({
                                path: relativePath,
                                type: 'content_changed',
                            });

                            if (options?.conflictResolution === 'skip') {
                                shouldRestore = false;
                            } else if (options?.conflictResolution === 'prompt') {
                                const choice = await vscode.window.showWarningMessage(
                                    t('checkpoint.fileModified', { path: relativePath }),
                                    t('checkpoint.yes'), t('checkpoint.no'), t('checkpoint.yesToAll'),
                                );
                                if (choice === t('checkpoint.no')) {
                                    shouldRestore = false;
                                } else if (choice === t('checkpoint.yesToAll')) {
                                    if (options) {
                                        options.conflictResolution = 'overwrite';
                                    }
                                }
                            }
                        }
                    } catch {
                        // File doesn't exist, no conflict
                    }

                    if (shouldRestore) {
                        await restoreTestHooks?.beforeWrite?.(relativePath, processedFiles);
                        await writeSnapshotContent(host, snapshot);
                        restoredFiles.push(relativePath);
                        if (journal) {
                            journal.completedWrites.push(relativePath);
                            await writeRestoreJournal(host, journal);
                        }
                    }
                } catch (error) {
                    failedFiles.push({
                        path: relativePath,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }

                processedFiles++;
                const progressPercent = 20 + (processedFiles / totalFiles) * 70;
                progress.report({
                    increment: progressPercent - (progress as any).value || 0,
                    message: t('checkpoint.restoringFile', { path: relativePath }),
                });
            }

            const writesSucceeded = failedFiles.length === 0 && !cancelled;
            if (writesSucceeded && options?.cleanupExtraFiles !== false && checkpointData.fileInventory) {
                progress.report({ increment: 90, message: t('checkpoint.removingExtraFiles') });
                const keepPaths = [
                    ...checkpointData.fileInventory,
                    ...(checkpointData.skippedFiles?.map((skipped) => skipped.path) ?? []),
                ];
                await host.cleanupFilesNotInInventory(keepPaths, removedFiles, failedFiles);
            } else if (writesSucceeded && options?.cleanupExtraFiles !== false) {
                const syntheticSnapshots: FileSnapshot[] = entries.map(([relativePath, resolved]) => ({
                    relativePath,
                    content: resolved.content,
                    encoding: resolved.encoding,
                    lastModified: new Date(),
                    size: resolved.content.length,
                }));
                progress.report({ increment: 90, message: t('checkpoint.cleaningUp') });
                await host.cleanupExtraFiles(syntheticSnapshots, removedFiles, failedFiles, options);
            } else if (!writesSucceeded) {
                log.warn('Skipping extra-file cleanup because restore writes did not fully succeed');
            }

            progress.report({
                increment: 100,
                message: cancelled
                    ? t('checkpoint.restoreProgress.cancelled')
                    : t('checkpoint.restorationComplete'),
            });
        });

        if ((cancelled || failedFiles.length > 0) && backupCheckpointId && !options?.skipJournal) {
            log.warn(`Restore of ${checkpointId} did not complete; rolling back via backup ${backupCheckpointId}`);
            if (journal) {
                journal.status = 'rolling_back';
                await writeRestoreJournal(host, journal);
            }
            const previousHooks = restoreTestHooks;
            restoreTestHooks = undefined;
            try {
                await restoreCheckpoint(host, backupCheckpointId, {
                    createBackup: false,
                    skipJournal: true,
                    conflictResolution: 'overwrite',
                    cleanupExtraFiles: false,
                });
            } finally {
                restoreTestHooks = previousHooks;
            }
            await clearRestoreJournal(host);
            await host.recordRestorationEvent({
                timestamp: new Date().toISOString(),
                checkpointId,
                success: false,
                durationMs: Date.now() - restoreStartedAt,
                filesRestored: 0,
                filesFailed: failedFiles.length,
                error: cancelled ? 'cancelled' : failedFiles[0]?.error,
            }).catch(() => false);
            return {
                success: false,
                restoredFiles: [],
                failedFiles,
                conflicts,
                removedFiles: [],
            };
        }

        if (!options?.skipJournal) {
            await clearRestoreJournal(host);
        }

        log.info(`✅ Restored checkpoint: ${checkpointId} (${restoredFiles.length} files restored, ${failedFiles.length} failed)`);

        const hasFilesToRestore = stateAtCheckpoint.size > 0;
        const success = failedFiles.length === 0 && (restoredFiles.length > 0 || !hasFilesToRestore);

        await host.recordRestorationEvent({
            timestamp: new Date().toISOString(),
            checkpointId,
            success,
            durationMs: Date.now() - restoreStartedAt,
            filesRestored: restoredFiles.length,
            filesFailed: failedFiles.length,
            error: failedFiles[0]?.error,
        }).catch(() => false);

        return {
            success,
            restoredFiles,
            failedFiles,
            conflicts,
            removedFiles,
        };
    } catch (error) {
        if (error instanceof BlobEncryptionError) {
            const message = encryptionFailureMessage(error);
            await host.recordRestorationEvent({
                timestamp: new Date().toISOString(),
                checkpointId,
                success: false,
                durationMs: Date.now() - restoreStartedAt,
                filesRestored: 0,
                filesFailed: 1,
                error: message,
            }).catch(() => false);
            return {
                success: false,
                restoredFiles: [],
                failedFiles: [{ path: '*', error: message }],
                conflicts: [],
                removedFiles: [],
            };
        }
        log.error(`Failed to restore checkpoint ${checkpointId}:`, error);
        await host.recordRestorationEvent({
            timestamp: new Date().toISOString(),
            checkpointId,
            success: false,
            durationMs: Date.now() - restoreStartedAt,
            filesRestored: 0,
            filesFailed: 0,
            error: error instanceof Error ? error.message : String(error),
        }).catch(() => false);
        throw error;
    }
}

export async function restoreCheckpointFiles(
    host: CheckpointEngineHost,
    checkpointId: string,
    relativePaths: string[],
): Promise<RestoreFilesResult> {
    if (!host.initialized) {
        throw new Error('Checkpoint system not initialized');
    }
    if (!host.currentWorkspacePath) {
        throw new Error('No workspace available');
    }

    const stateAtCheckpoint = await reconstructStateAtCheckpoint(host, checkpointId);
    if (!stateAtCheckpoint) {
        if (host.lastCheckpointLoad?.status === 'corrupt') {
            throw new Error(
                t('checkpoint.corrupt', {
                    id: checkpointId,
                    reason: host.lastCheckpointLoad.reason,
                }),
            );
        }
        throw new Error(`Checkpoint data not found or corrupted for ${checkpointId}`);
    }

    const wanted = new Set(relativePaths);
    const restoredFiles: string[] = [];
    const failedFiles: Array<{ path: string; error: string }> = [];
    const restoreStartedAt = Date.now();

    for (const relativePath of wanted) {
        const sandboxed = resolveWorkspaceRelativePath(host, relativePath);
        if (!sandboxed.ok) {
            failedFiles.push({
                path: relativePath,
                error: sandboxEscapeError(relativePath),
            });
            continue;
        }
        const fullPath = sandboxed.fullPath;
        const resolved = stateAtCheckpoint.get(relativePath);
        try {
            if (!resolved) {
                try {
                    await fs.promises.unlink(fullPath);
                    await removeEmptyDirectories(host, path.dirname(fullPath));
                } catch {
                    // Already gone — treat as restored
                }
            } else {
                const snapshot: FileSnapshot = {
                    relativePath,
                    content: resolved.content,
                    hash: resolved.hash,
                    encoding: resolved.encoding,
                    lastModified: new Date(),
                    size: resolved.content.length,
                };
                await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
                await writeSnapshotContent(host, snapshot);
            }
            restoredFiles.push(relativePath);
        } catch (error) {
            failedFiles.push({
                path: relativePath,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    log.info(`✅ Selective restore from ${checkpointId}: ${restoredFiles.length} restored, ${failedFiles.length} failed`);

    const success = failedFiles.length === 0 && restoredFiles.length > 0;
    await host.recordRestorationEvent({
        timestamp: new Date().toISOString(),
        checkpointId,
        success,
        durationMs: Date.now() - restoreStartedAt,
        filesRestored: restoredFiles.length,
        filesFailed: failedFiles.length,
        error: failedFiles[0]?.error,
    }).catch(() => false);

    return {
        success,
        restoredFiles,
        failedFiles,
    };
}

export type { ResolvedFileState };
