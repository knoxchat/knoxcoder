import * as assert from 'node:assert';

import {
    buildCheckpointTimeline,
    classifyCheckpointKind,
} from './timeline';
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

suite('checkpoint timeline view-model (CP-25)', () => {
    test('classifyCheckpointKind uses tags, roles, auto prefix, and fork bases', () => {
        const feature = branch('br_feature', 'feature', {
            baseCheckpointId: 'cp_fork',
            parentBranchId: 'br_main',
        });
        assert.strictEqual(
            classifyCheckpointKind(cp('cp_merge', { tags: ['merge'] }), []),
            'merge',
        );
        assert.strictEqual(
            classifyCheckpointKind(cp('cp_ai', {
                conversationContext: {
                    messageContent: 'edit',
                    role: 'agent-turn',
                    timestamp: '2026-08-17T12:00:00.000Z',
                    index: 0,
                },
            }), []),
            'ai',
        );
        assert.strictEqual(
            classifyCheckpointKind(cp('cp_auto', {
                messageId: 'auto-1',
                description: 'Auto: Periodic checkpoint at 12:00',
            }), []),
            'auto',
        );
        assert.strictEqual(
            classifyCheckpointKind(cp('cp_fork'), [feature]),
            'branch-point',
        );
        assert.strictEqual(classifyCheckpointKind(cp('cp_manual'), []), 'manual');
    });

    test('does not map unassigned checkpoints onto a default main line', () => {
        const main = branch('br_main', 'main', {
            headCheckpointId: 'cp_main',
            baseCheckpointId: 'cp_main',
        });
        const feature = branch('br_feature', 'feature', {
            headCheckpointId: 'cp_feat',
            baseCheckpointId: 'cp_main',
            parentBranchId: 'br_main',
        });
        const timeline = buildCheckpointTimeline({
            history: [
                cp('cp_orphan', { description: 'no branch' }),
                cp('cp_main', { branchId: 'br_main', description: 'on main' }),
                cp('cp_feat', { branchId: 'br_feature', description: 'on feature' }),
            ],
            branches: [main, feature],
            activeBranchId: 'br_feature',
        });

        const mainLine = timeline.branches.find((item) => item.id === 'br_main');
        const featureLine = timeline.branches.find((item) => item.id === 'br_feature');
        assert.deepStrictEqual(mainLine?.checkpoints, ['cp_main']);
        assert.deepStrictEqual(featureLine?.checkpoints, ['cp_feat']);
        assert.strictEqual(featureLine?.isActive, true);
        assert.strictEqual(mainLine?.isActive, false);
        const orphan = timeline.checkpoints.find((item) => item.id === 'cp_orphan');
        assert.ok(orphan);
        assert.strictEqual(orphan?.branchId, undefined);
        assert.ok(!mainLine?.checkpoints.includes('cp_orphan'));
        assert.ok(!featureLine?.checkpoints.includes('cp_orphan'));
    });

    test('hides user-query placeholders and keeps two named lines', () => {
        const main = branch('br_main', 'main', {
            headCheckpointId: 'cp_b',
            baseCheckpointId: 'cp_a',
        });
        const experiment = branch('br_exp', 'experiment', {
            headCheckpointId: 'cp_c',
            baseCheckpointId: 'cp_a',
            parentBranchId: 'br_main',
        });
        const timeline = buildCheckpointTimeline({
            history: [
                cp('cp_hidden', {
                    description: 'User query at index 3',
                    conversationContext: {
                        messageContent: 'hi',
                        role: 'user',
                        timestamp: '2026-08-17T12:00:00.000Z',
                        index: 3,
                    },
                }),
                cp('cp_a', { branchId: 'br_main', created: new Date('2026-08-17T10:00:00.000Z') }),
                cp('cp_b', { branchId: 'br_main', created: new Date('2026-08-17T11:00:00.000Z') }),
                cp('cp_c', {
                    branchId: 'br_exp',
                    created: new Date('2026-08-17T11:30:00.000Z'),
                    captureMode: 'delta',
                    fileStats: { total: 2, created: 1, modified: 1, deleted: 0 },
                }),
            ],
            branches: [main, experiment],
            activeBranchId: 'br_main',
        });

        assert.strictEqual(timeline.checkpoints.length, 3);
        assert.ok(!timeline.checkpoints.some((item) => item.id === 'cp_hidden'));
        assert.strictEqual(timeline.branches.length, 2);
        const delta = timeline.checkpoints.find((item) => item.id === 'cp_c');
        assert.strictEqual(delta?.isIncremental, true);
        assert.deepStrictEqual(delta?.fileChanges, { added: 1, modified: 1, deleted: 0 });
    });
});
