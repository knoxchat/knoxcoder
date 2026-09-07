import * as fs from 'node:fs/promises';

import { createKnoxLogger } from 'core/util/knoxLog';

import { blobExists, referencedBlobHashes, summarizeUnreferencedBlobs } from '../store/blobStore';
import type { CheckpointEngineHost } from './host';
import {
    collectReferencedBlobHashes,
    gcUnreferencedCheckpointBlobs,
    getStoragePath,
    readCheckpointRecord,
    rebuildHistoryFromManifests,
} from './persistence';
import { recoverIncompleteRestore } from './restore';
import { readRestoreJournal } from './restoreJournal';
import {
    emptyStoreHealthReport,
    type StoreHealthReport,
} from './storeHealthReport';

export type { StoreHealthReport } from './storeHealthReport';
export {
    emptyStoreHealthReport,
    gcOrphansSucceeded,
    repairAllSucceeded,
    storeHealthIsAutoFixable,
    storeHealthSeverity,
} from './storeHealthReport';

const log = createKnoxLogger('Checkpoints');

export interface StoreRepairOptions {
    journal?: boolean;
    index?: boolean;
    gc?: boolean;
}

export interface StoreRepairResult {
    journalRecovered: boolean;
    indexRebuilt: boolean;
    blobsDeleted: number;
    bytesReclaimed: number;
}

async function listManifestIds(host: CheckpointEngineHost): Promise<string[]> {
    const storagePath = getStoragePath(host);
    let entries: string[];
    try {
        entries = await fs.readdir(storagePath);
    } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    const ids: string[] = [];
    for (const entry of entries) {
        if (entry.startsWith('cp_') && entry.endsWith('.json')) {
            ids.push(entry.slice(0, -'.json'.length));
        }
    }
    return ids;
}

export async function inspectStoreHealth(host: CheckpointEngineHost): Promise<StoreHealthReport> {
    const report = emptyStoreHealthReport();
    const storageRoot = getStoragePath(host);

    const journal = await readRestoreJournal(host);
    if (journal) {
        report.incompleteJournal = true;
        report.journalCheckpointId = journal.checkpointId;
    }

    const manifestIds = await listManifestIds(host);
    const validDiskIds = new Set<string>();

    for (const checkpointId of manifestIds) {
        const result = await readCheckpointRecord(host, checkpointId);
        if (result.status === 'corrupt') {
            report.corruptManifests.push({ checkpointId, reason: result.reason });
            continue;
        }
        if (result.status !== 'ok') {
            continue;
        }

        validDiskIds.add(checkpointId);
        report.validManifestCount++;

        const hashes = referencedBlobHashes(result.checkpoint.fileSnapshots);
        let missing = 0;
        for (const hash of hashes) {
            if (!(await blobExists(storageRoot, hash))) {
                missing++;
                report.missingBlobs.push({ checkpointId, hash });
            }
        }
        if (hashes.length > 0 && missing === hashes.length) {
            report.manifestsWithoutBlobs.push({
                checkpointId,
                missingBlobCount: missing,
            });
        }
    }

    const historyIds = new Set(host.checkpointHistory.map((checkpoint) => checkpoint.id));
    for (const id of validDiskIds) {
        if (!historyIds.has(id)) {
            report.indexNeedsRebuild = true;
            break;
        }
    }
    if (!report.indexNeedsRebuild) {
        for (const id of historyIds) {
            if (!validDiskIds.has(id) && !manifestIds.includes(id)) {
                report.indexNeedsRebuild = true;
                break;
            }
        }
        // History points at a corrupt/missing file that is still listed.
        if (!report.indexNeedsRebuild) {
            for (const id of historyIds) {
                if (report.corruptManifests.some((entry) => entry.checkpointId === id)) {
                    report.indexNeedsRebuild = true;
                    break;
                }
            }
        }
    }

    try {
        const referenced = await collectReferencedBlobHashes(host);
        const orphans = await summarizeUnreferencedBlobs(storageRoot, referenced);
        report.orphanBlobCount = orphans.count;
        report.orphanBlobBytes = orphans.bytes;
    } catch (error) {
        log.debug('Failed to summarize unreferenced checkpoint blobs:', error);
    }

    return report;
}

export async function repairStoreHealth(
    host: CheckpointEngineHost,
    options: StoreRepairOptions = { journal: true, index: true, gc: true },
): Promise<StoreRepairResult> {
    const result: StoreRepairResult = {
        journalRecovered: false,
        indexRebuilt: false,
        blobsDeleted: 0,
        bytesReclaimed: 0,
    };

    if (options.journal !== false) {
        const journal = await readRestoreJournal(host);
        if (journal) {
            await recoverIncompleteRestore(host);
            result.journalRecovered = (await readRestoreJournal(host)) == null;
        }
    }

    if (options.index !== false) {
        result.indexRebuilt = await rebuildHistoryFromManifests(host);
    }

    if (options.gc !== false) {
        const gc = await gcUnreferencedCheckpointBlobs(host);
        result.blobsDeleted = gc.deleted;
        result.bytesReclaimed = gc.bytesReclaimed;
    }

    return result;
}
