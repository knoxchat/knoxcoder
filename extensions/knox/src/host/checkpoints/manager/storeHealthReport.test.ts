import * as assert from 'node:assert';

import { emptyStoreHealthReport, gcOrphansSucceeded, repairAllSucceeded, storeHealthIsAutoFixable, storeHealthSeverity } from './storeHealthReport';

suite('storeHealthReport (CP-21)', () => {
    test('storeHealthSeverity treats corrupt manifests as warning/critical', () => {
        assert.strictEqual(storeHealthSeverity(emptyStoreHealthReport()), 'healthy');
        assert.strictEqual(storeHealthSeverity({
            ...emptyStoreHealthReport(),
            corruptManifests: [{ checkpointId: 'cp_a', reason: 'checksum' }],
            indexNeedsRebuild: true,
            validManifestCount: 1,
        }), 'warning');
        assert.strictEqual(storeHealthSeverity({
            ...emptyStoreHealthReport(),
            corruptManifests: [{ checkpointId: 'cp_a', reason: 'checksum' }],
            validManifestCount: 0,
        }), 'critical');
        assert.strictEqual(storeHealthSeverity({
            ...emptyStoreHealthReport(),
            incompleteJournal: true,
        }), 'critical');
        assert.strictEqual(storeHealthSeverity({
            ...emptyStoreHealthReport(),
            orphanBlobCount: 1,
            orphanBlobBytes: 8,
        }), 'warning');
    });

    test('orphans are not auto-fixable while corrupt manifests remain', () => {
        assert.ok(storeHealthIsAutoFixable({
            ...emptyStoreHealthReport(),
            orphanBlobCount: 2,
            orphanBlobBytes: 10,
            validManifestCount: 1,
        }));
        assert.ok(!storeHealthIsAutoFixable({
            ...emptyStoreHealthReport(),
            corruptManifests: [{ checkpointId: 'cp_a', reason: 'checksum' }],
            orphanBlobCount: 2,
            orphanBlobBytes: 10,
        }));
        assert.ok(storeHealthIsAutoFixable({
            ...emptyStoreHealthReport(),
            incompleteJournal: true,
            corruptManifests: [{ checkpointId: 'cp_a', reason: 'checksum' }],
        }));
    });

    test('gc_orphans and repair_all success require real repair', () => {
        const none = { journalRecovered: false, indexRebuilt: false, blobsDeleted: 0 };
        const healthy = emptyStoreHealthReport();
        assert.strictEqual(gcOrphansSucceeded(healthy, none, healthy), true);
        assert.strictEqual(repairAllSucceeded(healthy), true);

        const dirty = { ...emptyStoreHealthReport(), orphanBlobCount: 2 };
        assert.strictEqual(gcOrphansSucceeded(dirty, none, dirty), false);
        assert.strictEqual(gcOrphansSucceeded(dirty, { ...none, blobsDeleted: 2 }, healthy), true);
        assert.strictEqual(repairAllSucceeded(dirty), false);

        const leftover = {
            ...emptyStoreHealthReport(),
            orphanBlobCount: 1,
            corruptManifests: [{ checkpointId: 'cp_x', reason: 'checksum' }],
        };
        assert.strictEqual(gcOrphansSucceeded(dirty, { ...none, blobsDeleted: 1 }, leftover), true);
        assert.strictEqual(repairAllSucceeded(leftover), true);
    });
});
