import * as assert from 'node:assert';

import {
    chronologicalUpTo,
    DEFAULT_BRANCH_NAME,
    generateBranchId,
    hashStateToSnapshots,
    isBranchId,
    lineageCheckpoints,
    lowestCommonAncestorId,
    parseBranch,
    parseBranches,
    replayHashState,
    threeWayMergeHashes,
} from './branchLogic';
import type { CheckpointInfo, FileHashState, FileSnapshot } from './types';

function cp(
    id: string,
    overrides: Partial<CheckpointInfo> = {},
): CheckpointInfo {
    const created = overrides.created ?? new Date('2026-01-01T00:00:00.000Z');
    return {
        id,
        description: id,
        created,
        ...overrides,
    };
}

function state(hash: string): FileHashState {
    return { hash, encoding: 'utf8', size: hash.length };
}

suite('checkpoint branch logic (CP-24)', () => {
    test('generateBranchId is UUID-unique with br_ prefix', () => {
        const id = generateBranchId();
        assert.ok(id.startsWith('br_'));
        assert.ok(isBranchId(id));
        const ids = new Set(Array.from({ length: 20 }, () => generateBranchId()));
        assert.strictEqual(ids.size, 20);
    });

    test('parseBranches skips malformed records', () => {
        const parsed = parseBranches([
            {
                id: 'br_one',
                name: DEFAULT_BRANCH_NAME,
                headCheckpointId: 'cp_a',
                baseCheckpointId: 'cp_a',
                createdAt: '2026-08-17T00:00:00.000Z',
            },
            { id: 'nope' },
            null,
        ]);
        assert.strictEqual(parsed.length, 1);
        assert.strictEqual(parsed[0].name, 'main');
        assert.ok(parsed[0].createdAt instanceof Date);
        assert.strictEqual(parseBranch(undefined), null);
    });

    test('legacy checkpoints without parents reconstruct chronologically', () => {
        const history = [
            cp('cp_1', { created: new Date('2026-01-01T00:00:00.000Z') }),
            cp('cp_2', { created: new Date('2026-01-02T00:00:00.000Z') }),
            cp('cp_3', { created: new Date('2026-01-03T00:00:00.000Z') }),
        ];
        const line = lineageCheckpoints(history, 'cp_2');
        assert.deepStrictEqual(line?.map((item) => item.id), ['cp_1', 'cp_2']);
        assert.strictEqual(chronologicalUpTo(history, 'missing'), null);
    });

    test('parentCheckpointId lineage excludes a sibling branch', () => {
        const history = [
            cp('cp_1', { created: new Date('2026-01-01T00:00:00.000Z') }),
            cp('cp_2', {
                created: new Date('2026-01-02T00:00:00.000Z'),
                parentCheckpointId: 'cp_1',
                branchId: 'br_main',
            }),
            cp('cp_feat', {
                created: new Date('2026-01-03T00:00:00.000Z'),
                parentCheckpointId: 'cp_2',
                branchId: 'br_feat',
            }),
            cp('cp_main2', {
                created: new Date('2026-01-04T00:00:00.000Z'),
                parentCheckpointId: 'cp_2',
                branchId: 'br_main',
            }),
        ];
        assert.deepStrictEqual(
            lineageCheckpoints(history, 'cp_feat')?.map((item) => item.id),
            ['cp_1', 'cp_2', 'cp_feat'],
        );
        assert.deepStrictEqual(
            lineageCheckpoints(history, 'cp_main2')?.map((item) => item.id),
            ['cp_1', 'cp_2', 'cp_main2'],
        );
        assert.strictEqual(lowestCommonAncestorId(history, 'cp_feat', 'cp_main2'), 'cp_2');
    });

    test('retargeted parent after deleting a middle checkpoint still walks ancestors', () => {
        const history = [
            cp('cp_1', { created: new Date('2026-01-01T00:00:00.000Z') }),
            cp('cp_3', {
                created: new Date('2026-01-03T00:00:00.000Z'),
                parentCheckpointId: 'cp_1',
            }),
        ];
        assert.deepStrictEqual(
            lineageCheckpoints(history, 'cp_3')?.map((item) => item.id),
            ['cp_1', 'cp_3'],
        );
    });

    test('three-way merge auto-resolves non-overlapping hash changes', () => {
        const base = new Map<string, FileHashState>([
            ['a.ts', state('hashA')],
            ['b.ts', state('hashB')],
            ['c.ts', state('hashC')],
        ]);
        const source = new Map<string, FileHashState>([
            ['a.ts', state('hashA2')],
            ['b.ts', state('hashB')],
            ['c.ts', state('hashC')],
        ]);
        const target = new Map<string, FileHashState>([
            ['a.ts', state('hashA')],
            ['b.ts', state('hashB2')],
            ['c.ts', state('hashC')],
        ]);
        const { merged, conflicts } = threeWayMergeHashes(base, source, target);
        assert.deepStrictEqual(conflicts, []);
        assert.strictEqual(merged.get('a.ts')?.hash, 'hashA2');
        assert.strictEqual(merged.get('b.ts')?.hash, 'hashB2');
        assert.strictEqual(merged.get('c.ts')?.hash, 'hashC');
    });

    test('three-way merge reports conflicts and does not pick a side', () => {
        const base = new Map<string, FileHashState>([['a.ts', state('hashA')]]);
        const source = new Map<string, FileHashState>([['a.ts', state('hashS')]]);
        const target = new Map<string, FileHashState>([['a.ts', state('hashT')]]);
        const { merged, conflicts } = threeWayMergeHashes(base, source, target);
        assert.strictEqual(merged.has('a.ts'), false);
        assert.deepStrictEqual(conflicts, [{
            path: 'a.ts',
            baseHash: 'hashA',
            sourceHash: 'hashS',
            targetHash: 'hashT',
        }]);
    });

    test('hashStateToSnapshots records deletes for dropped paths', () => {
        const merged = new Map<string, FileHashState>([['keep.ts', state('abc')]]);
        const { snapshots, inventory } = hashStateToSnapshots(merged, ['keep.ts', 'gone.ts']);
        assert.deepStrictEqual(inventory, ['keep.ts']);
        const deleted = snapshots.find((snapshot) => snapshot.relativePath === 'gone.ts');
        assert.strictEqual(deleted?.deleted, true);
        assert.strictEqual(deleted?.changeType, 'deleted');
    });

    test('replayHashState overlays deltas including deletes', () => {
        const snapshots: FileSnapshot[] = [
            { relativePath: 'a.ts', hash: 'h1', encoding: 'utf8', lastModified: new Date(), size: 1 },
            { relativePath: 'b.ts', hash: 'h2', encoding: 'utf8', lastModified: new Date(), size: 1 },
        ];
        const delta: FileSnapshot[] = [
            { relativePath: 'b.ts', encoding: 'utf8', lastModified: new Date(), size: 0, deleted: true, changeType: 'deleted' },
            { relativePath: 'c.ts', hash: 'h3', encoding: 'utf8', lastModified: new Date(), size: 1, changeType: 'created' },
        ];
        const stateMap = replayHashState([{ fileSnapshots: snapshots }, { fileSnapshots: delta }]);
        assert.strictEqual(stateMap.get('a.ts')?.hash, 'h1');
        assert.strictEqual(stateMap.has('b.ts'), false);
        assert.strictEqual(stateMap.get('c.ts')?.hash, 'h3');
    });
});
