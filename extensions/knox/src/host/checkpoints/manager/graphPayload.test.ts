import * as assert from 'node:assert';

import { buildCheckpointGraph } from './graphPayload';
import { TIMELINE_BRANCH_COLORS } from './timeline';
import type { CheckpointBranch, CheckpointInfo } from './types';

function cp(id: string, overrides: Partial<CheckpointInfo> = {}): CheckpointInfo {
    return {
        id,
        description: overrides.description ?? id,
        created: overrides.created ?? new Date('2026-08-17T12:00:00.000Z'),
        ...overrides,
    };
}

function branch(id: string, name: string, overrides: Partial<CheckpointBranch> = {}): CheckpointBranch {
    return {
        id,
        name,
        headCheckpointId: overrides.headCheckpointId ?? id,
        baseCheckpointId: overrides.baseCheckpointId ?? id,
        createdAt: overrides.createdAt ?? new Date('2026-08-17T00:00:00.000Z'),
        ...overrides,
    };
}

suite('checkpoint graph payload (CPG-03)', () => {
    test('linear chain is newest-first with a single parent link', () => {
        const main = branch('br_main', 'main', {
            headCheckpointId: 'cp_tip',
            baseCheckpointId: 'cp_root',
        });
        const graph = buildCheckpointGraph({
            history: [
                cp('cp_root', {
                    branchId: 'br_main',
                    created: new Date('2026-08-17T10:00:00.000Z'),
                    description: 'root',
                    fileSnapshots: [{
                        relativePath: 'secret.txt',
                        content: 'SECRET_BYTES',
                        encoding: 'utf8',
                        lastModified: new Date('2026-08-17T10:00:00.000Z'),
                        size: 12,
                    }],
                }),
                cp('cp_mid', {
                    branchId: 'br_main',
                    parentCheckpointId: 'cp_root',
                    created: new Date('2026-08-17T11:00:00.000Z'),
                    pinned: true,
                    sessionId: 'sess-graph',
                    changedPaths: ['src/auth.ts', 'src/login.tsx'],
                    fileStats: { total: 3, created: 1, modified: 2, deleted: 0 },
                }),
                cp('cp_tip', {
                    branchId: 'br_main',
                    parentCheckpointId: 'cp_mid',
                    created: new Date('2026-08-17T12:00:00.000Z'),
                    tags: ['merge'],
                    description: 'merged tip',
                }),
            ],
            branches: [main],
            activeBranchId: 'br_main',
        });

        assert.deepStrictEqual(graph.nodes.map((node) => node.id), ['cp_tip', 'cp_mid', 'cp_root']);
        assert.deepStrictEqual(graph.nodes.map((node) => node.parents), [
            ['cp_mid'],
            ['cp_root'],
            [],
        ]);
        assert.strictEqual(graph.headCheckpointId, 'cp_tip');
        assert.strictEqual(graph.branches[0]?.isActive, true);
        assert.strictEqual(graph.branches[0]?.color, TIMELINE_BRANCH_COLORS[0]);
        assert.strictEqual(graph.nodes[0]?.kind, 'merge');
        assert.strictEqual(graph.nodes[0]?.shortId, 'cp_tip');
        assert.strictEqual(graph.nodes[1]?.pinned, true);
        assert.strictEqual(graph.nodes[2]?.pinned, false);
        assert.deepStrictEqual(graph.nodes[1]?.fileChanges, { added: 1, modified: 2, deleted: 0 });
        assert.deepStrictEqual(graph.nodes[1]?.changedPaths, ['src/auth.ts', 'src/login.tsx']);
        assert.strictEqual(graph.nodes[1]?.sessionId, 'sess-graph');
        assert.deepStrictEqual(graph.nodes[2]?.changedPaths, ['secret.txt']);
        assert.strictEqual(JSON.stringify(graph).includes('SECRET_BYTES'), false);
        assert.strictEqual(JSON.stringify(graph).includes('fileSnapshots'), false);
        assert.strictEqual(JSON.stringify(graph).includes('content'), false);
    });

    test('a checkpoint with no parent has an empty parents array', () => {
        const graph = buildCheckpointGraph({
            history: [cp('cp_orphan', { description: 'alone' })],
            branches: [],
        });

        assert.strictEqual(graph.nodes.length, 1);
        assert.deepStrictEqual(graph.nodes[0]?.parents, []);
        assert.strictEqual(graph.headCheckpointId, null);
        assert.strictEqual(graph.nodes[0]?.shortId, 'cp_orphan');
    });

    test('fork keeps the child baseCheckpointId and does not invent a second parent', () => {
        const main = branch('br_main', 'main', {
            headCheckpointId: 'cp_main',
            baseCheckpointId: 'cp_root',
        });
        const feature = branch('br_feature', 'feature', {
            headCheckpointId: 'cp_feat',
            baseCheckpointId: 'cp_root',
            parentBranchId: 'br_main',
        });
        const graph = buildCheckpointGraph({
            history: [
                cp('cp_root', {
                    branchId: 'br_main',
                    created: new Date('2026-08-17T10:00:00.000Z'),
                }),
                cp('cp_feat', {
                    branchId: 'br_feature',
                    parentCheckpointId: 'cp_root',
                    created: new Date('2026-08-17T11:00:00.000Z'),
                }),
                cp('cp_main', {
                    branchId: 'br_main',
                    parentCheckpointId: 'cp_root',
                    created: new Date('2026-08-17T12:00:00.000Z'),
                }),
            ],
            branches: [main, feature],
            activeBranchId: 'br_main',
        });

        const featureLine = graph.branches.find((item) => item.id === 'br_feature');
        assert.strictEqual(featureLine?.baseCheckpointId, 'cp_root');
        assert.strictEqual(featureLine?.headCheckpointId, 'cp_feat');
        assert.strictEqual(featureLine?.isActive, false);
        assert.strictEqual(featureLine?.color, TIMELINE_BRANCH_COLORS[1]);
        const feat = graph.nodes.find((node) => node.id === 'cp_feat');
        assert.deepStrictEqual(feat?.parents, ['cp_root']);
        assert.strictEqual(graph.headCheckpointId, 'cp_main');
        assert.ok(graph.nodes.some((node) => node.id === 'cp_root' && node.parents.length === 0));
    });

    test('branch filter keeps the selected line and its fork point', () => {
        const main = branch('br_main', 'main', {
            headCheckpointId: 'cp_main',
            baseCheckpointId: 'cp_root',
        });
        const feature = branch('br_feature', 'feature', {
            headCheckpointId: 'cp_feat',
            baseCheckpointId: 'cp_root',
            parentBranchId: 'br_main',
        });
        const graph = buildCheckpointGraph({
            history: [
                cp('cp_hidden', {
                    description: 'User query at index 1',
                    conversationContext: {
                        messageContent: 'hi',
                        role: 'user',
                        timestamp: '2026-08-17T09:00:00.000Z',
                        index: 1,
                    },
                }),
                cp('cp_root', {
                    branchId: 'br_main',
                    created: new Date('2026-08-17T10:00:00.000Z'),
                }),
                cp('cp_main', {
                    branchId: 'br_main',
                    parentCheckpointId: 'cp_root',
                    created: new Date('2026-08-17T12:00:00.000Z'),
                }),
                cp('cp_feat', {
                    branchId: 'br_feature',
                    parentCheckpointId: 'cp_root',
                    created: new Date('2026-08-17T11:00:00.000Z'),
                    description: 'on feature',
                }),
                cp('cp_other', {
                    branchId: 'br_other',
                    created: new Date('2026-08-17T11:30:00.000Z'),
                }),
            ],
            branches: [main, feature],
            activeBranchId: 'br_feature',
            branchIds: ['br_feature'],
        });

        assert.deepStrictEqual(graph.nodes.map((node) => node.id), ['cp_feat', 'cp_root']);
        assert.strictEqual(graph.headCheckpointId, 'cp_feat');
        assert.strictEqual(graph.branches.length, 2);
        assert.strictEqual(graph.branches[1]?.color, TIMELINE_BRANCH_COLORS[1]);
        assert.strictEqual(graph.branches[1]?.isActive, true);

        const none = buildCheckpointGraph({
            history: [
                cp('cp_root', { branchId: 'br_main' }),
                cp('cp_feat', { branchId: 'br_feature', parentCheckpointId: 'cp_root' }),
            ],
            branches: [main, feature],
            activeBranchId: 'br_feature',
            branchIds: [],
        });
        assert.deepStrictEqual(none.nodes, []);
        assert.strictEqual(none.branches.length, 2);
        assert.strictEqual(none.headCheckpointId, 'cp_feat');
    });

    test('equal timestamps break ties by id, and limit keeps the newest page', () => {
        const same = new Date('2026-08-17T12:00:00.000Z');
        const graph = buildCheckpointGraph({
            history: [
                cp('cp_b', { created: same }),
                cp('cp_a', { created: same }),
                cp('cp_old', { created: new Date('2026-08-17T09:00:00.000Z') }),
            ],
            branches: [],
            limit: 2,
        });

        assert.strictEqual(graph.hasMore, true);
        assert.deepStrictEqual(graph.nodes.map((node) => node.id), ['cp_a', 'cp_b']);
        const longId = 'cp_abcdef0123456789';
        const trimmed = buildCheckpointGraph({
            history: [cp(longId)],
            branches: [],
        });
        assert.strictEqual(trimmed.nodes[0]?.shortId, 'cp_abcdef01');
        assert.strictEqual(trimmed.hasMore, false);
    });

    test('parentCheckpointIds become parents, and a lone parentCheckpointId stays one edge', () => {
        const merged = buildCheckpointGraph({
            history: [
                cp('cp_merge', {
                    parentCheckpointId: 'cp_target',
                    parentCheckpointIds: ['cp_target', 'cp_source'],
                    created: new Date('2026-08-17T12:00:00.000Z'),
                }),
                cp('cp_old', {
                    parentCheckpointId: 'cp_root',
                    created: new Date('2026-08-17T11:00:00.000Z'),
                }),
            ],
            branches: [],
        });
        assert.deepStrictEqual(merged.nodes[0]?.parents, ['cp_target', 'cp_source']);
        assert.deepStrictEqual(merged.nodes[1]?.parents, ['cp_root']);
    });
});
