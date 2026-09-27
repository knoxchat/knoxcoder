import * as assert from 'node:assert';
import * as path from 'node:path';

import {
    captureFilterIsActive,
    fileSetsOverlap,
    isExactIncludePath,
    normalizeCapturePath,
    pathMatchesPattern,
    shouldCaptureRelativePath,
} from './pathFilter';

suite('checkpoint pathFilter', () => {
    const workspace = path.join('/tmp', 'proj');

    test('matches exact relative files and directory prefixes', () => {
        assert.strictEqual(pathMatchesPattern(workspace, 'a.ts', 'a.ts'), true);
        assert.strictEqual(pathMatchesPattern(workspace, 'b.ts', 'a.ts'), false);
        assert.strictEqual(pathMatchesPattern(workspace, 'src/a.ts', 'src'), true);
        assert.strictEqual(pathMatchesPattern(workspace, 'src/a.ts', 'src/'), true);
        assert.strictEqual(pathMatchesPattern(workspace, 'srcfoo.ts', 'src'), false);
    });

    test('normalizes absolute and backslash paths', () => {
        const abs = path.join(workspace, 'src', 'a.ts');
        assert.strictEqual(normalizeCapturePath(workspace, abs), 'src/a.ts');
        assert.strictEqual(pathMatchesPattern(workspace, 'src/a.ts', abs), true);
        assert.strictEqual(pathMatchesPattern(workspace, 'src\\a.ts', 'src/a.ts'), true);
    });

    test('include then exclude', () => {
        assert.strictEqual(
            shouldCaptureRelativePath(workspace, 'a.ts', { includeFiles: ['a.ts'] }),
            true,
        );
        assert.strictEqual(
            shouldCaptureRelativePath(workspace, 'b.ts', { includeFiles: ['a.ts'] }),
            false,
        );
        assert.strictEqual(
            shouldCaptureRelativePath(workspace, 'src/a.ts', { excludeFiles: ['src'] }),
            false,
        );
        assert.strictEqual(
            shouldCaptureRelativePath(workspace, 'a.ts', {
                includeFiles: ['a.ts', 'b.ts'],
                excludeFiles: ['b.ts'],
            }),
            true,
        );
        assert.strictEqual(
            shouldCaptureRelativePath(workspace, 'b.ts', {
                includeFiles: ['a.ts', 'b.ts'],
                excludeFiles: ['b.ts'],
            }),
            false,
        );
    });

    test('exact include vs directory include', () => {
        assert.strictEqual(isExactIncludePath(workspace, 'a.ts', ['a.ts']), true);
        assert.strictEqual(isExactIncludePath(workspace, 'src/a.ts', ['src']), false);
        assert.strictEqual(captureFilterIsActive({ includeFiles: ['a.ts'] }), true);
        assert.strictEqual(captureFilterIsActive({}), false);
    });

    test('fileSetsOverlap treats empty as the whole workspace', () => {
        assert.strictEqual(fileSetsOverlap(workspace, [], ['a.ts']), true);
        assert.strictEqual(fileSetsOverlap(workspace, ['a.ts'], ['a.ts']), true);
        assert.strictEqual(fileSetsOverlap(workspace, ['a.ts'], ['b.ts']), false);
        assert.strictEqual(fileSetsOverlap(workspace, ['src'], ['src/a.ts']), true);
    });
});
