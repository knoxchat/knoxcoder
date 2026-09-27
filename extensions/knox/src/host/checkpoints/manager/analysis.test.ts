import * as assert from 'node:assert';

import {
    ANALYSIS_TIME_GAP_MS,
    buildCheckpointAnalysis,
    classifyChangedPaths,
    dominantPathPrefix,
    isConfigPath,
    isLockfilePath,
    isTestPath,
    suggestCheckpointGroupsFromHistory,
} from './analysis';
import type { CheckpointInfo } from './types';

function cp(id: string, overrides: Partial<CheckpointInfo> = {}): CheckpointInfo {
    return {
        id,
        description: id,
        created: overrides.created ?? new Date('2026-08-17T00:00:00.000Z'),
        ...overrides,
    };
}

suite('checkpoint analysis heuristics (CP-26)', () => {
    test('classifies config, lockfile, tests, deletions, and binary', () => {
        const counts = classifyChangedPaths([
            { relativePath: 'package.json', changeType: 'modified' },
            { relativePath: 'yarn.lock', changeType: 'modified' },
            { relativePath: 'src/app.test.ts', changeType: 'modified' },
            { relativePath: 'gone.ts', deleted: true, changeType: 'deleted' },
            { relativePath: 'icon.png', encoding: 'base64', changeType: 'created' },
        ]);
        assert.strictEqual(counts.config, 1);
        assert.strictEqual(counts.lockfile, 1);
        assert.strictEqual(counts.tests, 1);
        assert.strictEqual(counts.deleted, 1);
        assert.strictEqual(counts.binary, 1);
        assert.strictEqual(counts.changed, 5);
        assert.ok(isConfigPath('tsconfig.json'));
        assert.ok(isLockfilePath('pnpm-lock.yaml'));
        assert.ok(isTestPath('pkg/foo_test.go'));
    });

    test('config and deletions raise risk above Low', () => {
        const analysis = buildCheckpointAnalysis({
            checkpointId: 'cp_1',
            description: 'Touch package.json',
            captureMode: 'delta',
            paths: [
                { relativePath: 'package.json', changeType: 'modified' },
                { relativePath: 'src/old.ts', deleted: true, changeType: 'deleted' },
            ],
            linesAdded: 4,
            linesDeleted: 20,
        });
        assert.ok(analysis.riskAssessment.score >= 2.5);
        assert.notStrictEqual(analysis.riskAssessment.level, 'Low');
        assert.strictEqual(analysis.impactAnalysis.scope, 'SystemWide');
        assert.ok(analysis.generatedDescription.includes('package.json') || analysis.generatedDescription.includes('config'));
        assert.ok(analysis.riskAssessment.factors.some((factor) => factor.category === 'Config'));
        assert.ok(analysis.riskAssessment.factors.some((factor) => factor.category === 'Deletions'));
        assert.ok(analysis.impactAnalysis.affectedFeatures.some((feature) => feature.changedFiles.length > 0));
    });

    test('suggestCheckpointGroups returns session and time clusters', () => {
        const t0 = new Date('2026-08-17T10:00:00.000Z');
        const history = [
            cp('cp_a', { created: t0, sessionId: 'sess-1', changedPaths: ['src/a.ts'] }),
            cp('cp_b', {
                created: new Date(t0.getTime() + 5 * 60 * 1000),
                sessionId: 'sess-1',
                changedPaths: ['src/b.ts'],
            }),
            cp('cp_c', {
                created: new Date(t0.getTime() + ANALYSIS_TIME_GAP_MS + 10 * 60 * 1000),
                sessionId: 'sess-2',
                changedPaths: ['docs/readme.md'],
            }),
            cp('cp_d', {
                created: new Date(t0.getTime() + ANALYSIS_TIME_GAP_MS + 12 * 60 * 1000),
                sessionId: 'sess-2',
                changedPaths: ['docs/guide.md'],
            }),
        ];
        const groups = suggestCheckpointGroupsFromHistory(history);
        const sessions = groups.filter((group) => group.kind === 'session');
        const times = groups.filter((group) => group.kind === 'time');
        const paths = groups.filter((group) => group.kind === 'path');

        assert.ok(sessions.some((group) => group.checkpointIds.includes('cp_a') && group.checkpointIds.includes('cp_b')));
        assert.ok(sessions.some((group) => group.checkpointIds.includes('cp_c') && group.checkpointIds.includes('cp_d')));
        assert.ok(times.some((group) => group.checkpointIds.includes('cp_a') && group.checkpointIds.includes('cp_b')));
        assert.ok(times.every((group) => !(group.checkpointIds.includes('cp_a') && group.checkpointIds.includes('cp_c'))));
        assert.ok(paths.some((group) => group.groupName === 'src' && group.checkpointIds.includes('cp_a')));
        assert.ok(paths.some((group) => group.groupName === 'docs' && group.checkpointIds.includes('cp_c')));
        assert.strictEqual(dominantPathPrefix(history[0]), 'src');
    });

    test('user-query context checkpoints are not grouped', () => {
        const t0 = new Date('2026-08-17T10:00:00.000Z');
        const groups = suggestCheckpointGroupsFromHistory([
            cp('cp_user', {
                created: t0,
                sessionId: 'sess-1',
                conversationContext: { role: 'user', messageContent: 'hi', timestamp: t0.toISOString(), index: 0 },
                changedPaths: ['src/a.ts'],
            }),
            cp('cp_user2', {
                created: new Date(t0.getTime() + 1000),
                sessionId: 'sess-1',
                conversationContext: { role: 'user', messageContent: 'hi', timestamp: t0.toISOString(), index: 1 },
                changedPaths: ['src/b.ts'],
            }),
        ]);
        assert.deepStrictEqual(groups, []);
    });
});
