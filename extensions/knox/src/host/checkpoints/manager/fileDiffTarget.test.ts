import * as assert from 'node:assert';

import { selectCheckpointFileDiff } from './fileDiffTarget';
import type { CheckpointDiffResult } from './types';

function diff(files: CheckpointDiffResult['files']): CheckpointDiffResult {
    return {
        oldCheckpoint: { id: 'cp_old', description: 'old', created: '2026-08-17T00:00:00.000Z' },
        newCheckpoint: { id: 'cp_new', description: 'new', created: '2026-08-17T01:00:00.000Z' },
        files,
    };
}

suite('checkpoint file diff target (CPG-07)', () => {
    test('a stored file is selected', () => {
        const selected = selectCheckpointFileDiff(diff([{
            relativePath: 'src/auth.ts',
            status: 'modified',
            oldContent: 'a',
            newContent: 'b',
        }]), 'src\\auth.ts');
        assert.strictEqual(selected.ok, true);
        if (selected.ok) {
            assert.strictEqual(selected.file.relativePath, 'src/auth.ts');
        }
    });

    test('a missing diff uses the no-snapshots error', () => {
        assert.deepStrictEqual(selectCheckpointFileDiff(null, 'src/auth.ts'), {
            ok: false,
            error: 'noSnapshots',
        });
    });

    test('a path with no stored blob uses the no-original-content error', () => {
        assert.deepStrictEqual(selectCheckpointFileDiff(diff([]), 'src/missing.ts'), {
            ok: false,
            error: 'noOriginalContent',
        });
        assert.deepStrictEqual(selectCheckpointFileDiff(diff([{
            relativePath: 'src/empty.ts',
            status: 'modified',
            oldContent: null,
            newContent: null,
        }]), 'src/empty.ts'), {
            ok: false,
            error: 'noOriginalContent',
        });
    });
});
