import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    DEFAULT_CHECKPOINT_IGNORE_PATTERNS,
} from '../checkpointIgnore';
import {
    inventoryPathsFromScan,
    scanWorkspaceFiles,
    type WorkspaceScanHost,
} from './workspaceScan';

const ignore = require('ignore');

function makeHost(workspacePath: string, overrides: Partial<WorkspaceScanHost> = {}): WorkspaceScanHost {
    return {
        currentWorkspacePath: workspacePath,
        maxScanDepth: 0,
        maxFileSize: 5 * 1024 * 1024,
        captureBinaryFiles: true,
        extraTrackedExtensions: new Set(),
        ignoreFilter: ignore().add(DEFAULT_CHECKPOINT_IGNORE_PATTERNS),
        ignoreFilterFailed: false,
        ...overrides,
    };
}

async function withTempWorkspace(fn: (root: string) => Promise<void>): Promise<void> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knox-scan-'));
    try {
        await fn(root);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
}

suite('workspaceScan', () => {
    test('walks trees deeper than 10 levels and skips ignored directories without reading them', async () => {
        await withTempWorkspace(async (root) => {
            const nestedParts = Array.from({ length: 12 }, (_, i) => `d${i}`);
            const deepDir = path.join(root, ...nestedParts);
            await fs.mkdir(deepDir, { recursive: true });
            await fs.writeFile(path.join(deepDir, 'deep.ts'), 'export const deep = 1;\n');

            const ignoredPkg = path.join(root, 'node_modules', 'left-pad', 'nested');
            await fs.mkdir(ignoredPkg, { recursive: true });
            await fs.writeFile(path.join(ignoredPkg, 'index.js'), 'module.exports = 1;\n');

            const scan = await scanWorkspaceFiles(makeHost(root));
            const inventory = inventoryPathsFromScan(scan);
            const deepRelative = path.join(...nestedParts, 'deep.ts');

            assert.ok(inventory.includes(deepRelative), 'nested file beyond 10 levels must be inventoried');
            assert.ok(
                !inventory.some((relativePath) => relativePath.includes('node_modules')),
                'ignored node_modules files must not be inventoried',
            );
            assert.ok(
                scan.stats.skippedIgnoredDirs.includes('node_modules'),
                'node_modules must be skipped as a directory',
            );
            assert.ok(
                !scan.stats.skippedIgnoredDirs.some((dir) => dir.startsWith('node_modules/')),
                'node_modules must not be readdir’d (children would appear as skipped dirs)',
            );
        });
    });

    test('optional maxScanDepth cap still stops a walk when the user sets one', async () => {
        await withTempWorkspace(async (root) => {
            const nestedParts = Array.from({ length: 12 }, (_, i) => `d${i}`);
            const deepDir = path.join(root, ...nestedParts);
            await fs.mkdir(deepDir, { recursive: true });
            await fs.writeFile(path.join(deepDir, 'deep.ts'), 'export const deep = 1;\n');
            await fs.writeFile(path.join(root, 'top.ts'), 'export const top = 1;\n');

            const scan = await scanWorkspaceFiles(makeHost(root, { maxScanDepth: 3 }));
            const inventory = inventoryPathsFromScan(scan);
            assert.ok(inventory.includes('top.ts'));
            assert.ok(!inventory.includes(path.join(...nestedParts, 'deep.ts')));
        });
    });

    test('inventory omits files over maxFileSize and records them as skipped', async () => {
        await withTempWorkspace(async (root) => {
            await fs.writeFile(path.join(root, 'ok.ts'), 'export const ok = 1;\n');
            await fs.writeFile(path.join(root, 'huge.ts'), 'x'.repeat(2048));

            const scan = await scanWorkspaceFiles(makeHost(root, { maxFileSize: 1024 }));
            const inventory = inventoryPathsFromScan(scan);
            assert.ok(inventory.includes('ok.ts'));
            assert.ok(!inventory.includes('huge.ts'));
            assert.ok(
                scan.skippedFiles.some((skipped) => skipped.path === 'huge.ts' && skipped.reason === 'too_large'),
            );
        });
    });
});
