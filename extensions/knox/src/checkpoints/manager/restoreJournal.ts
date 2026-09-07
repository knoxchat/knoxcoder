import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { createKnoxLogger } from 'core/util/knoxLog';

import { writeFileAtomic } from '../store/atomicWrite';
import type { CheckpointEngineHost } from './host';

const log = createKnoxLogger('Checkpoints');

export const RESTORE_TMP_SUFFIX = '.knox-restore-tmp';
export const RESTORE_JOURNAL_FILENAME = 'restore-journal.json';

export interface RestoreJournal {
    schemaVersion: 1;
    checkpointId: string;
    backupCheckpointId?: string;
    startedAt: string;
    plannedWrites: string[];
    plannedDeletes: string[];
    completedWrites: string[];
    status: 'writing' | 'rolling_back';
}

export function getRestoreJournalPath(host: CheckpointEngineHost): string {
    return path.join(host.getStoragePath(), RESTORE_JOURNAL_FILENAME);
}

export async function readRestoreJournal(host: CheckpointEngineHost): Promise<RestoreJournal | null> {
    const journalPath = getRestoreJournalPath(host);
    try {
        const raw = await fsp.readFile(journalPath, 'utf8');
        const parsed = JSON.parse(raw) as RestoreJournal;
        if (!parsed || parsed.schemaVersion !== 1 || !parsed.checkpointId) {
            return null;
        }
        return parsed;
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            return null;
        }
        log.warn('Failed to read restore journal:', error);
        return null;
    }
}

export async function writeRestoreJournal(
    host: CheckpointEngineHost,
    journal: RestoreJournal,
): Promise<void> {
    await writeFileAtomic(getRestoreJournalPath(host), JSON.stringify(journal, null, 2), 'utf8');
}

export async function clearRestoreJournal(host: CheckpointEngineHost): Promise<void> {
    try {
        await fsp.unlink(getRestoreJournalPath(host));
    } catch (error: any) {
        if (error?.code !== 'ENOENT') {
            log.warn('Failed to clear restore journal:', error);
        }
    }
}

export async function removeRestoreTempFile(fullPath: string): Promise<void> {
    try {
        await fsp.unlink(fullPath + RESTORE_TMP_SUFFIX);
    } catch (error: any) {
        if (error?.code !== 'ENOENT') {
            log.debug(`Could not remove restore temp for ${fullPath}:`, error instanceof Error ? error.message : String(error));
        }
    }
}

export function restoreTempPath(fullPath: string): string {
    return fullPath + RESTORE_TMP_SUFFIX;
}

export async function replaceWithRestoreTemp(tempPath: string, targetPath: string): Promise<void> {
    try {
        await fsp.rename(tempPath, targetPath);
    } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EEXIST' || code === 'EPERM' || code === 'EACCES') {
            await fsp.unlink(targetPath);
            await fsp.rename(tempPath, targetPath);
            return;
        }
        throw error;
    }
}

export function journalExistsSync(host: CheckpointEngineHost): boolean {
    return fs.existsSync(getRestoreJournalPath(host));
}
