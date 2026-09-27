import * as assert from 'node:assert';

import {
    classifyFileBuffer,
    detectFileEncoding,
    shouldTrackFile,
} from './fileClassification';
import { bytesFromSnapshotContent, snapshotContentFromBytes } from '../store/blobStore';

const captureOn = {
    captureBinaryFiles: true,
    extraTrackedExtensions: new Set<string>(),
};

const captureOff = {
    captureBinaryFiles: false,
    extraTrackedExtensions: new Set<string>(),
};

const MINIMAL_PNG = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
    'hex',
);

const MINIMAL_PDF = Buffer.from('%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'utf8');

function utf16LeWithBom(text: string): Buffer {
    return Buffer.from(`\uFEFF${text}`, 'utf16le');
}

function utf16BeWithBom(text: string): Buffer {
    return bytesFromSnapshotContent(`\uFEFF${text}`, 'utf16be');
}

suite('fileClassification encoding (CP-30)', () => {
    test('PNG and PDF use base64 and do not decode as UTF-8', () => {
        assert.strictEqual(detectFileEncoding('icon.png', MINIMAL_PNG), 'base64');
        assert.strictEqual(detectFileEncoding('doc.pdf', MINIMAL_PDF), 'base64');
        const png = classifyFileBuffer('icon.png', MINIMAL_PNG, captureOn);
        assert.ok(png);
        assert.strictEqual(png.encoding, 'base64');
        assert.deepStrictEqual(bytesFromSnapshotContent(png.content, png.encoding), MINIMAL_PNG);
        assert.notStrictEqual(png.content, MINIMAL_PNG.toString('utf8'));
    });

    test('NUL bytes in a .txt file are binary, not UTF-8', () => {
        const bytes = Buffer.from('hello\0world', 'utf8');
        assert.strictEqual(detectFileEncoding('notes.txt', bytes), 'base64');
        const classified = classifyFileBuffer('notes.txt', bytes, captureOn);
        assert.ok(classified);
        assert.strictEqual(classified.encoding, 'base64');
        assert.deepStrictEqual(bytesFromSnapshotContent(classified.content, 'base64'), bytes);
    });

    test('UTF-16 LE/BE BOM files are not stored as UTF-8', () => {
        const le = utf16LeWithBom('Hello, 世界');
        const be = utf16BeWithBom('Hello, 世界');
        assert.strictEqual(detectFileEncoding('hello.txt', le), 'utf16le');
        assert.strictEqual(detectFileEncoding('hello.txt', be), 'utf16be');

        const leClassified = classifyFileBuffer('hello.txt', le, captureOn);
        const beClassified = classifyFileBuffer('hello.txt', be, captureOn);
        assert.ok(leClassified);
        assert.ok(beClassified);
        assert.strictEqual(leClassified.encoding, 'utf16le');
        assert.strictEqual(beClassified.encoding, 'utf16be');
        assert.deepStrictEqual(bytesFromSnapshotContent(leClassified.content, 'utf16le'), le);
        assert.deepStrictEqual(bytesFromSnapshotContent(beClassified.content, 'utf16be'), be);
        assert.notStrictEqual(leClassified.content, le.toString('utf8'));
    });

    test('UTF-16 without BOM is detected from NUL lanes', () => {
        const le = Buffer.from('Hello world', 'utf16le');
        const be = bytesFromSnapshotContent('Hello world', 'utf16be');
        assert.strictEqual(detectFileEncoding('hello.txt', le), 'utf16le');
        assert.strictEqual(detectFileEncoding('hello.txt', be), 'utf16be');
    });

    test('UTF-8 source stays utf8', () => {
        const bytes = Buffer.from('export const n = 1;\n', 'utf8');
        assert.strictEqual(detectFileEncoding('a.ts', bytes), 'utf8');
        const classified = classifyFileBuffer('a.ts', bytes, captureOn);
        assert.ok(classified);
        assert.strictEqual(classified.encoding, 'utf8');
        assert.strictEqual(classified.content, 'export const n = 1;\n');
    });

    test('binary capture off skips PNG and NUL files', () => {
        assert.strictEqual(classifyFileBuffer('icon.png', MINIMAL_PNG, captureOff), null);
        assert.strictEqual(
            classifyFileBuffer('notes.txt', Buffer.from('a\0b'), captureOff),
            null,
        );
    });

    test('archives and video stay untracked unless the user opts in', () => {
        assert.strictEqual(shouldTrackFile('pack.zip', captureOn), false);
        assert.strictEqual(shouldTrackFile('clip.mp4', captureOn), false);
        assert.strictEqual(shouldTrackFile('pack.zip', {
            captureBinaryFiles: true,
            extraTrackedExtensions: new Set(['zip']),
        }), true);
    });

    test('utf16be codec round-trips BOM and payload', () => {
        const original = utf16BeWithBom('Hi');
        const text = snapshotContentFromBytes(original, 'utf16be');
        assert.deepStrictEqual(bytesFromSnapshotContent(text, 'utf16be'), original);
    });
});
