import * as path from 'path';

import { createKnoxLogger } from 'core/util/knoxLog';

import { generateCheckpointId } from '../checkpointId';
import { bindCheckpointToActiveLine } from './branches';
import { applySnapshotHashes, captureWorkspaceState } from './capture';
import type { CheckpointEngineHost } from './host';
import { captureFilterIsActive, type CaptureFilter } from './pathFilter';
import {
    initializeStorageDirectories,
    saveCheckpointToDisk,
} from './persistence';
import { enforceRetentionPolicies } from './retention';
import type {
    AgentCheckpointOptions,
    CaptureMode,
    CheckpointInfo,
    IncrementalCheckpointOptions,
    ManualCheckpointOptions,
} from './types';
import { workspaceHasBaseline, workspaceStorageKey } from './workspace';
import { changedPathsFromSnapshots } from './listQuery';

const log = createKnoxLogger('Checkpoints');

interface CreateCheckpointRecordOptions extends ManualCheckpointOptions {
    messageId?: string;
    stableId?: string;
    conversationContext?: CheckpointInfo['conversationContext'];
    applyTrackedAIFiles?: boolean;
}

function normalizeTags(tags?: string[]): string[] | undefined {
    if (!tags?.length) {
        return undefined;
    }
    const unique = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
    return unique.length > 0 ? unique : undefined;
}

function buildCaptureFilter(
    host: CheckpointEngineHost,
    options?: CreateCheckpointRecordOptions,
): CaptureFilter | undefined {
    const include = [...(options?.includeFiles ?? [])];
    const exclude = [...(options?.excludeFiles ?? [])];

    if (options?.applyTrackedAIFiles && host.trackedAIFiles.size > 0 && host.currentWorkspacePath) {
        include.push(...host.trackedAIFiles);
        for (const absPath of host.recentlyModifiedFiles) {
            include.push(path.relative(host.currentWorkspacePath, absPath));
        }
        for (const absPath of host.recentlyDeletedFiles) {
            include.push(path.relative(host.currentWorkspacePath, absPath));
        }
    }

    if (include.length === 0 && exclude.length === 0) {
        return undefined;
    }
    return {
        includeFiles: include.length > 0 ? include : undefined,
        excludeFiles: exclude.length > 0 ? exclude : undefined,
    };
}

async function createCheckpointRecord(
    host: CheckpointEngineHost,
    options: CreateCheckpointRecordOptions = {},
): Promise<string | undefined> {
    if (!host.initialized) {
        log.warn('⚠️ Checkpoint system not initialized');
        return undefined;
    }

    if (!host.currentWorkspacePath) {
        log.warn('⚠️ No workspace path available for checkpoint creation');
        return undefined;
    }

    const messageId = options.messageId;
    if (messageId && host.messageCheckpoints[messageId]) {
        log.info(`✅ Checkpoint already exists for message ${messageId}: ${host.messageCheckpoints[messageId].substring(0, 8)}`);
        return host.messageCheckpoints[messageId];
    }

    if (options.stableId && host.stableIdCheckpoints[options.stableId]) {
        log.info(`✅ Checkpoint already exists for stableId ${options.stableId}: ${host.stableIdCheckpoints[options.stableId].substring(0, 8)}`);
        return host.stableIdCheckpoints[options.stableId];
    }

    try {
        await initializeStorageDirectories(host);

        const createdAt = Date.now();

        const filter = buildCaptureFilter(host, options);
        const filtered = captureFilterIsActive(filter);
        const needsBaseline = !workspaceHasBaseline(host);
        const recordedMode: CaptureMode = filtered
            ? 'delta'
            : (options.forceBaseline || needsBaseline ? 'baseline' : 'delta');
        const walkMode: CaptureMode = filter?.includeFiles?.length
            ? 'delta'
            : (recordedMode === 'baseline' || (filtered && needsBaseline) ? 'baseline' : 'delta');

        log.info(`📸 Capturing workspace state (${recordedMode}${filtered ? ', filtered' : ''})...`);
        if (options.forceDelta && recordedMode === 'baseline') {
            log.info('Incremental requested but no baseline exists; capturing a full-tree baseline first');
        }
        const captured = await captureWorkspaceState(host, walkMode, filter);
        if (filtered) {
            captured.captureMode = 'delta';
        }
        const fileSnapshots = captured.fileSnapshots;
        const fileInventory = captured.fileInventory;

        const isContextOnly = options.conversationContext?.role === 'user';
        const allowEmpty =
            options.allowEmpty === true
            || isContextOnly
            || options.conversationContext?.allowEmpty === true
            || (needsBaseline && !filtered);

        if (fileSnapshots.length === 0 && !allowEmpty) {
            log.info('No changed files detected, skipping checkpoint creation');
            return undefined;
        }

        if (allowEmpty && fileSnapshots.length === 0) {
            log.info('Creating context-only checkpoint (no file changes, for AI context)');
        }

        const boundSessionId = typeof host.getBoundSessionId === 'function'
            ? host.getBoundSessionId()
            : null;
        const conversationContext = options.conversationContext
            ? {
                ...options.conversationContext,
                sessionId: options.conversationContext.sessionId || boundSessionId || undefined,
            }
            : undefined;
        const sessionId = conversationContext?.sessionId || boundSessionId || undefined;
        const checkpointId = generateCheckpointId();
        const tags = normalizeTags(options.tags);
        const checkpointInfo: CheckpointInfo = {
            id: checkpointId,
            description: options.description || (messageId
                ? `Checkpoint for message ${messageId}`
                : `Manual checkpoint - ${new Date().toLocaleString()}`),
            created: new Date(),
            messageId,
            stableId: options.stableId,
            workspacePath: host.currentWorkspacePath,
            workspaceKey: host.currentWorkspacePath
                ? workspaceStorageKey(host.currentWorkspacePath)
                : undefined,
            fileSnapshots,
            fileInventory,
            captureMode: captured.captureMode,
            skippedFiles: captured.skippedFiles,
            sessionId,
            changedPaths: changedPathsFromSnapshots(fileSnapshots),
            conversationContext,
            ...(tags ? { tags } : {}),
        };
        bindCheckpointToActiveLine(host, checkpointInfo);

        host.checkpointHistory.push(checkpointInfo);
        if (messageId) {
            host.messageCheckpoints[messageId] = checkpointId;
        }
        if (options.stableId) {
            host.stableIdCheckpoints[options.stableId] = checkpointId;
        }

        await saveCheckpointToDisk(host, checkpointInfo);
        await host.saveCheckpointHistory();
        applySnapshotHashes(host, fileSnapshots);
        host.lastCheckpointTime = Date.now();
        host.fireCheckpointCreated(checkpointId);

        if (fileSnapshots.length > host.maxFilesPerCheckpoint) {
            log.warn(
                `⚠️ Checkpoint ${checkpointId} captured ${fileSnapshots.length} files ` +
                `(maxFilesPerCheckpoint=${host.maxFilesPerCheckpoint}); continuing without truncation`,
            );
        }

        log.info(`✅ Created checkpoint ${checkpointId} with ${fileSnapshots.length} files`);
        await host.appendAuditEvent({
            action: 'create',
            resourceId: checkpointId,
            outcome: 'success',
            durationMs: Date.now() - createdAt,
            counts: { files: fileSnapshots.length },
        }).catch(() => false);
        await host.recordStorageSnapshot().catch(() => false);
        await enforceRetentionPolicies(host);
        return checkpointId;
    } catch (error) {
        log.error('Failed to create checkpoint:', error);
        await host.appendAuditEvent({
            action: 'create',
            outcome: 'failure',
            error: error instanceof Error ? error.message : String(error),
        }).catch(() => false);
        return undefined;
    }
}

export async function createCheckpointForMessage(
    host: CheckpointEngineHost,
    messageId: string,
    description?: string,
    stableId?: string,
    conversationContext?: CheckpointInfo['conversationContext'],
): Promise<string | undefined> {
    const isContextOnly = conversationContext && conversationContext.role === 'user';
    return createCheckpointRecord(host, {
        description,
        messageId,
        stableId,
        conversationContext,
        allowEmpty: isContextOnly || conversationContext?.allowEmpty === true,
        applyTrackedAIFiles: false,
    });
}

export async function createManualCheckpoint(
    host: CheckpointEngineHost,
    options?: ManualCheckpointOptions,
): Promise<string | undefined> {
    return createCheckpointRecord(host, {
        ...options,
        applyTrackedAIFiles: false,
    });
}

export async function createAgentCheckpoint(
    host: CheckpointEngineHost,
    options: AgentCheckpointOptions,
    boundAgentSessionId: string | null,
): Promise<string | undefined> {
    try {
        log.info(`📸 Creating agent checkpoint: ${options.description || 'AI changes'}`);
        const sessionId = options.sessionId || boundAgentSessionId;
        const checkpointId = await createCheckpointRecord(host, {
            description: options.description || 'AI agent changes',
            tags: options.tags,
            includeFiles: options.includeFiles,
            excludeFiles: options.excludeFiles,
            messageId: sessionId || `agent-${Date.now()}`,
            applyTrackedAIFiles: true,
            allowEmpty: true,
            conversationContext: sessionId
                ? {
                    role: 'agent-turn',
                    messageContent: options.description || 'AI agent changes',
                    timestamp: new Date().toISOString(),
                    index: 0,
                    sessionId,
                    allowEmpty: true,
                }
                : undefined,
        });

        if (checkpointId) {
            log.info(`✅ Agent checkpoint created: ${checkpointId.substring(0, 8)}...`);
        }

        return checkpointId;
    } catch (error) {
        log.error('❌ Failed to create agent checkpoint:', error);
        return undefined;
    }
}

export async function createIncrementalCheckpoint(
    host: CheckpointEngineHost,
    options: IncrementalCheckpointOptions | undefined,
    boundAgentSessionId: string | null,
): Promise<string | undefined> {
    const description = options?.description
        || (boundAgentSessionId
            ? `Incremental checkpoint - ${boundAgentSessionId}`
            : `Incremental checkpoint - ${new Date().toLocaleString()}`);
    log.info(`📸 Creating incremental (delta) checkpoint: ${description}`);
    return createCheckpointRecord(host, {
        description,
        tags: ['incremental', ...(options?.tags ?? [])],
        includeFiles: options?.includeFiles,
        excludeFiles: options?.excludeFiles,
        applyTrackedAIFiles: true,
        forceDelta: true,
        allowEmpty: false,
        conversationContext: boundAgentSessionId
            ? {
                role: 'agent-turn',
                messageContent: description,
                timestamp: new Date().toISOString(),
                index: 0,
                sessionId: boundAgentSessionId,
            }
            : undefined,
    });
}
