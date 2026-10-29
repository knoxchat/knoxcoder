/**
 * Portable patch export / apply (CP-47). Unified diffs with Knox trailers;
 * apply uses the cherry-pick three-way onto HEAD.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { createKnoxLogger } from 'core/util/knoxLog';

import { threeWayMergeText } from './branchLogic';
import { firstParentId } from './cherryPick';
import { createManualCheckpoint } from './create';
import { computeCheckpointDiff } from './diff';
import type { CheckpointEngineHost } from './host';
import type { ApplyPatchResult, CheckpointFileDiff, ExportPatchResult } from './types';
import { getCheckpointHistoryForWorkspace, resolveWorkspaceRelativePath } from './workspace';

const log = createKnoxLogger('Checkpoints');

export interface ParsedPatchFile {
    oldPath?: string;
    newPath?: string;
    renamedFrom?: string;
    oldContent: string;
    newContent: string;
    deleted?: boolean;
    added?: boolean;
}

function unifiedHunk(oldText: string | null, newText: string | null): string {
    const oldLines = oldText == null ? [] : oldText.split('\n');
    const newLines = newText == null ? [] : newText.split('\n');
    if (oldLines.length && oldLines[oldLines.length - 1] === '') {
        oldLines.pop();
    }
    if (newLines.length && newLines[newLines.length - 1] === '') {
        newLines.pop();
    }
    const lines: string[] = [];
    lines.push(`@@ -${oldText == null ? 0 : 1},${oldLines.length} +${newText == null ? 0 : 1},${newLines.length} @@`);
    for (const line of oldLines) {
        lines.push(`-${line}`);
    }
    for (const line of newLines) {
        lines.push(`+${line}`);
    }
    return lines.join('\n');
}

export function formatUnifiedPatch(
    files: CheckpointFileDiff[],
    meta: { id: string; description: string; created: Date; author?: string },
): string {
    const date = meta.created instanceof Date ? meta.created : new Date(meta.created);
    const header = [
        `From ${meta.id} ${date.toUTCString()}`,
        `Date: ${date.toISOString()}`,
        `Subject: ${meta.description || meta.id}`,
        `X-Knox-Checkpoint: ${meta.id}`,
        '',
    ];
    const bodies: string[] = [];
    for (const file of files) {
        if (file.oldEncoding && file.oldEncoding !== 'utf8' && file.oldContent?.includes('\0')) {
            continue;
        }
        const dest = file.relativePath;
        const src = file.oldPath || file.relativePath;
        const a = file.status === 'added' ? '/dev/null' : `a/${src}`;
        const b = file.status === 'deleted' ? '/dev/null' : `b/${dest}`;
        const block = [`diff --git ${a === '/dev/null' ? dest : `a/${src}`} ${b === '/dev/null' ? dest : `b/${dest}`}`];
        if (file.status === 'renamed' && file.oldPath) {
            block.push(`rename from ${file.oldPath}`);
            block.push(`rename to ${dest}`);
        }
        if (file.status === 'copied' && file.oldPath) {
            block.push(`copy from ${file.oldPath}`);
            block.push(`copy to ${dest}`);
        }
        block.push(`--- ${a}`);
        block.push(`+++ ${b}`);
        block.push(unifiedHunk(file.oldContent, file.newContent));
        bodies.push(block.join('\n'));
    }
    return `${header.join('\n')}${bodies.join('\n')}\n`;
}

export function parseUnifiedPatch(text: string): { files: ParsedPatchFile[]; checkpointId?: string; subject?: string } {
    if (!text.includes('diff --git') && !text.includes('--- ')) {
        throw new Error('Malformed patch: no diff --git or --- header');
    }
    const checkpointId = text.match(/^X-Knox-Checkpoint:\s*(\S+)/m)?.[1];
    const subject = text.match(/^Subject:\s*(.+)$/m)?.[1];
    const files: ParsedPatchFile[] = [];
    const chunks = text.split(/^diff --git /m).slice(1);
    if (chunks.length === 0) {
        throw new Error('Malformed patch: empty diff');
    }
    for (const chunk of chunks) {
        const renamedFrom = chunk.match(/^rename from (.+)$/m)?.[1]?.trim();
        const renameTo = chunk.match(/^rename to (.+)$/m)?.[1]?.trim();
        const oldHeader = chunk.match(/^--- (.+)$/m)?.[1]?.trim();
        const newHeader = chunk.match(/^\+\+\+ (.+)$/m)?.[1]?.trim();
        if (!oldHeader || !newHeader) {
            throw new Error('Malformed patch: missing ---/+++ headers');
        }
        const oldPath = oldHeader === '/dev/null' ? undefined : oldHeader.replace(/^a\//, '');
        const newPath = newHeader === '/dev/null' ? undefined : newHeader.replace(/^b\//, '');
        const oldLines: string[] = [];
        const newLines: string[] = [];
        const hunkStart = chunk.indexOf('@@');
        if (hunkStart < 0) {
            throw new Error('Malformed patch: missing hunk');
        }
        for (const line of chunk.slice(hunkStart).split('\n').slice(1)) {
            if (line.startsWith('diff --git') || line.startsWith('@@')) {
                continue;
            }
            if (line.startsWith('+')) {
                newLines.push(line.slice(1));
            } else if (line.startsWith('-')) {
                oldLines.push(line.slice(1));
            } else if (line.startsWith('\\')) {
                continue;
            } else if (line.startsWith(' ')) {
                oldLines.push(line.slice(1));
                newLines.push(line.slice(1));
            }
        }
        files.push({
            oldPath,
            newPath: newPath || renameTo,
            renamedFrom,
            oldContent: oldPath ? `${oldLines.join('\n')}\n` : '',
            newContent: newPath ? `${newLines.join('\n')}\n` : '',
            deleted: !newPath,
            added: !oldPath,
        });
    }
    return { files, checkpointId, subject };
}

export async function exportPatch(host: CheckpointEngineHost, checkpointId: string): Promise<ExportPatchResult> {
    await host.whenReady();
    const history = getCheckpointHistoryForWorkspace(host.checkpointHistory, host.currentWorkspacePath);
    const source = history.find((checkpoint) => checkpoint.id === checkpointId);
    if (!source) {
        return { success: false, message: `Checkpoint ${checkpointId} not found` };
    }
    const parentId = firstParentId(source);
    const diff = await computeCheckpointDiff(host, checkpointId, parentId);
    if (!diff) {
        return { success: false, message: `Could not diff ${checkpointId}` };
    }
    const textFiles = diff.files.filter((file) =>
        !(file.oldContent ?? '').includes('\0') && !(file.newContent ?? '').includes('\0'),
    );
    const patch = formatUnifiedPatch(textFiles, {
        id: source.id,
        description: source.label || source.description,
        created: source.created,
    });
    log.info(`Exported patch for ${checkpointId} (${textFiles.length} files)`);
    return { success: true, patch, checkpointId, fileCount: textFiles.length };
}

async function liveText(host: CheckpointEngineHost, relativePath: string): Promise<string | undefined> {
    const sandboxed = resolveWorkspaceRelativePath(host, relativePath);
    if (!sandboxed.ok) {
        return undefined;
    }
    try {
        const bytes = await fs.readFile(sandboxed.fullPath);
        if (bytes.includes(0)) {
            return undefined;
        }
        return bytes.toString('utf8');
    } catch {
        return '';
    }
}

function refusedPatch(message: string, conflicts: Array<{ path: string }> = []): ApplyPatchResult {
    return { success: false, restoredFiles: [], removedFiles: [], conflicts, message };
}

export async function applyPatch(host: CheckpointEngineHost, patchText: string): Promise<ApplyPatchResult> {
    await host.whenReady();
    let parsed: { files: ParsedPatchFile[]; subject?: string; checkpointId?: string };
    try {
        parsed = parseUnifiedPatch(patchText);
    } catch (error) {
        return refusedPatch(error instanceof Error ? error.message : String(error));
    }
    if (!host.currentWorkspacePath) {
        return refusedPatch('Checkpoint system is not ready');
    }

    const planned: Array<{ path: string; content: string | null }> = [];
    for (const file of parsed.files) {
        const dest = file.newPath || file.oldPath;
        if (!dest) {
            return refusedPatch('Malformed patch: file with no path');
        }
        const sandboxed = resolveWorkspaceRelativePath(host, dest);
        if (!sandboxed.ok) {
            return refusedPatch(`Unsafe patch path ${dest}`);
        }
        if (file.deleted) {
            planned.push({ path: dest, content: null });
            continue;
        }
        const ours = await liveText(host, dest);
        if (ours === undefined) {
            return refusedPatch(`Binary or unreadable ${dest}`);
        }
        const merged = threeWayMergeText(file.oldContent, ours, file.newContent);
        if ('conflict' in merged) {
            return refusedPatch(`Conflict applying ${dest}`, [{ path: dest }]);
        }
        planned.push({ path: dest, content: merged.content });
        if (file.renamedFrom && file.renamedFrom !== dest) {
            planned.push({ path: file.renamedFrom, content: null });
        }
    }

    for (const item of planned) {
        const sandboxed = resolveWorkspaceRelativePath(host, item.path);
        if (!sandboxed.ok) {
            continue;
        }
        if (item.content == null) {
            try {
                await fs.unlink(sandboxed.fullPath);
            } catch (error: unknown) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                    throw error;
                }
            }
            continue;
        }
        await fs.mkdir(path.dirname(sandboxed.fullPath), { recursive: true });
        await fs.writeFile(sandboxed.fullPath, item.content);
    }

    const created = await createManualCheckpoint(host, {
        description: parsed.subject || 'Apply patch',
        tags: ['patch', parsed.checkpointId || 'external'],
        includeFiles: planned.map((item) => item.path),
        allowEmpty: true,
    });
    await host.appendAuditEvent({
        action: 'patch',
        resourceId: created || undefined,
        outcome: created ? 'success' : 'failure',
        details: { files: planned.length, source: parsed.checkpointId },
    }).catch(() => false);
    log.info(`Applied patch as ${created}`);
    return {
        success: Boolean(created),
        checkpointId: created || undefined,
        restoredFiles: planned.filter((item) => item.content != null).map((item) => item.path),
        removedFiles: planned.filter((item) => item.content == null).map((item) => item.path),
        conflicts: [],
        message: created ? undefined : 'Patch written but checkpoint was empty',
    };
}
