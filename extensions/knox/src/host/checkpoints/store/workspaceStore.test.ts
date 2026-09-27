import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    canonicalizeWorkspacePath,
    findContainingWorkspaceFolder,
    isCheckpointDebugStorageMode,
    isUsableCheckpointWorkspacePath,
    resolveCheckpointStoragePathFor,
    workspacePathsEqual,
    workspaceStorageKey,
} from './workspaceStore';
import { getCheckpointHistoryForWorkspace } from '../manager/workspace';

suite('workspace isolation (CP-10)', () => {
    test('storage keys differ for two folders with the same relative files', () => {
        const a = workspaceStorageKey('/tmp/proj-a');
        const b = workspaceStorageKey('/tmp/proj-b');
        assert.notStrictEqual(a, b);
        assert.match(a, /^[0-9a-f]{16}$/);
    });

    test('trailing slashes, file URLs, and case fold to the same key on macOS/Windows', () => {
        const key = workspaceStorageKey('/Users/knox/proj');
        assert.strictEqual(workspaceStorageKey('/Users/knox/proj/'), key);
        assert.strictEqual(workspaceStorageKey('file:///Users/knox/proj'), key);
        if (process.platform === 'darwin' || process.platform === 'win32') {
            assert.strictEqual(workspaceStorageKey('/Users/Knox/Proj'), key);
        }
    });

    test('workspacePathsEqual matches file:// and trailing separators', () => {
        assert.ok(workspacePathsEqual('/tmp/workspace', 'file:///tmp/workspace/'));
        assert.ok(!workspacePathsEqual('/tmp/workspace-a', '/tmp/workspace-b'));
    });

    test('history filter uses workspaceKey when present', () => {
        const history = [
            {
                id: 'cp-a',
                description: 'A',
                created: new Date(),
                workspacePath: '/other',
                workspaceKey: workspaceStorageKey('/tmp/proj-a'),
            },
            {
                id: 'cp-b',
                description: 'B',
                created: new Date(),
                workspacePath: '/tmp/proj-b',
                workspaceKey: workspaceStorageKey('/tmp/proj-b'),
            },
        ];
        const forA = getCheckpointHistoryForWorkspace(history, '/tmp/proj-a');
        assert.strictEqual(forA.length, 1);
        assert.strictEqual(forA[0].id, 'cp-a');
    });

    test('production layout is workspaces/<key>/ under the global root', () => {
        const workspacePath = '/Users/knox/proj-a';
        const resolved = resolveCheckpointStoragePathFor(workspacePath, {
            debug: false,
            globalCheckpointsPath: '/tmp/knox-checkpoints',
        });
        assert.strictEqual(
            resolved,
            path.join('/tmp/knox-checkpoints', 'workspaces', workspaceStorageKey(workspacePath)),
        );
    });

    test('debug layout stays inside the workspace folder', () => {
        const workspacePath = '/Users/knox/proj-a';
        const resolved = resolveCheckpointStoragePathFor(workspacePath, {
            debug: true,
            globalCheckpointsPath: '/tmp/knox-checkpoints',
        });
        assert.strictEqual(resolved, path.join(workspacePath, '.knox-debug', 'checkpoints'));
        assert.ok(isCheckpointDebugStorageMode({ nodeEnv: 'development' }));
        assert.ok(!isCheckpointDebugStorageMode({ nodeEnv: 'production', appName: 'Visual Studio Code' }));
    });

    test('debug storage does not fall back to process.cwd or filesystem root', () => {
        const globalCheckpointsPath = '/tmp/knox-checkpoints';
        assert.ok(!isUsableCheckpointWorkspacePath(undefined));
        assert.ok(!isUsableCheckpointWorkspacePath(''));
        assert.ok(!isUsableCheckpointWorkspacePath('/'));
        assert.ok(!isUsableCheckpointWorkspacePath('relative/project'));
        assert.ok(isUsableCheckpointWorkspacePath('/Users/knox/proj-a'));

        assert.strictEqual(
            resolveCheckpointStoragePathFor(undefined, { debug: true, globalCheckpointsPath }),
            globalCheckpointsPath,
        );
        assert.strictEqual(
            resolveCheckpointStoragePathFor('/', { debug: true, globalCheckpointsPath }),
            globalCheckpointsPath,
        );
        assert.strictEqual(
            resolveCheckpointStoragePathFor('', { debug: true, globalCheckpointsPath }),
            globalCheckpointsPath,
        );
    });

    test('findContainingWorkspaceFolder prefers the longest root', () => {
        const nested = findContainingWorkspaceFolder(
            ['/work/app', '/work/app/packages/pkg'],
            '/work/app/packages/pkg/src/a.ts',
        );
        assert.strictEqual(nested, '/work/app/packages/pkg');
    });

    test('canonicalizeWorkspacePath is a pure string transform', () => {
        assert.strictEqual(
            canonicalizeWorkspacePath('/tmp/foo/', { caseInsensitive: false, sep: '/' }),
            '/tmp/foo',
        );
    });
});
