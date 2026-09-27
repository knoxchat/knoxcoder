import * as assert from 'node:assert';

import { resolveCheckpointGraphShell } from './graphShell';

suite('checkpoint graph shell (CPG-02)', () => {
    test('no workspace wins over init and count', () => {
        assert.deepStrictEqual(
            resolveCheckpointGraphShell({
                hasWorkspace: false,
                initialized: true,
                listableCount: 4,
            }),
            { state: 'no-workspace', checkpointCount: 0 },
        );
    });

    test('workspace that has not finished init', () => {
        assert.deepStrictEqual(
            resolveCheckpointGraphShell({
                hasWorkspace: true,
                initialized: false,
                listableCount: 0,
            }),
            { state: 'not-initialized', checkpointCount: 0 },
        );
    });

    test('initialized workspace with nothing to draw', () => {
        assert.deepStrictEqual(
            resolveCheckpointGraphShell({
                hasWorkspace: true,
                initialized: true,
                listableCount: 0,
            }),
            { state: 'empty', checkpointCount: 0 },
        );
    });

    test('ready reports the listable count', () => {
        assert.deepStrictEqual(
            resolveCheckpointGraphShell({
                hasWorkspace: true,
                initialized: true,
                listableCount: 48,
            }),
            { state: 'ready', checkpointCount: 48 },
        );
    });
});
