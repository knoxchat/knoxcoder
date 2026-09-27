import * as path from 'path';

import {
    snapshotContentFromBytes,
    type CheckpointContentEncoding,
} from '../store/blobStore';

export interface FileClassificationOptions {
    captureBinaryFiles: boolean;
    extraTrackedExtensions: Set<string>;
}

export type { CheckpointContentEncoding };

export const TEXT_EXTENSIONS = new Set([
    'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'java', 'cpp', 'cc', 'c', 'h', 'hpp', 'cs',
    'go', 'rs', 'php', 'rb', 'swift', 'kt', 'kts', 'html', 'htm', 'css',
    'scss', 'sass', 'less', 'json', 'jsonc', 'yaml', 'yml', 'md', 'mdx', 'txt', 'sh', 'bash',
    'zsh', 'bat', 'ps1', 'xml', 'svg', 'toml', 'ini', 'cfg', 'conf', 'env',
    'sql', 'graphql', 'gql', 'proto', 'vue', 'svelte', 'astro', 'dart', 'r', 'scala',
    'clj', 'ex', 'exs', 'erl', 'hs', 'jl', 'lua', 'pl', 'pm', 'vim', 'tf', 'tfvars',
    'gradle', 'properties', 'csv', 'tsv', 'lock', 'editorconfig', 'gitignore', 'gitattributes',
    'dockerfile', 'makefile', 'cmake', 'nix', 'zig', 'sol', 'm', 'mm',
]);

export const BINARY_SNAPSHOT_EXTENSIONS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'avif',
    'pdf', 'woff', 'woff2', 'ttf', 'otf', 'eot',
    'wasm', 'db', 'sqlite', 'sqlite3', 'bin', 'dat',
    'mp3', 'wav', 'ogg',
]);

export const NEVER_TRACK_EXTENSIONS = new Set([
    'log', 'tmp', 'swp', 'bak', 'exe', 'dll', 'so', 'dylib', 'node',
    'o', 'a', 'obj', 'class', 'pyc', 'pyo',
    'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'jar', 'war',
    'iso', 'dmg', 'pkg', 'deb', 'rpm',
    'mp4', 'mov', 'avi', 'mkv', 'webm',
]);

export function fileExtension(filePath: string): string {
    return path.extname(filePath).toLowerCase().substring(1);
}

export function isTextFile(filePath: string, extraTrackedExtensions: Set<string>): boolean {
    const base = path.basename(filePath).toLowerCase();
    const ext = fileExtension(filePath);

    if (!ext) {
        return true;
    }

    return TEXT_EXTENSIONS.has(ext) ||
        TEXT_EXTENSIONS.has(base) ||
        extraTrackedExtensions.has(ext);
}

export function isBinarySnapshotExtension(filePath: string): boolean {
    return BINARY_SNAPSHOT_EXTENSIONS.has(fileExtension(filePath));
}

export function shouldTrackFile(filePath: string, options: FileClassificationOptions): boolean {
    const ext = fileExtension(filePath);

    if (ext && NEVER_TRACK_EXTENSIONS.has(ext) && !options.extraTrackedExtensions.has(ext)) {
        return false;
    }
    if (isTextFile(filePath, options.extraTrackedExtensions)) {
        return true;
    }
    if (isBinarySnapshotExtension(filePath)) {
        return options.captureBinaryFiles;
    }
    return true;
}

export function isBinaryBuffer(buffer: Buffer): boolean {
    const sampleLength = Math.min(buffer.length, 8192);
    for (let i = 0; i < sampleLength; i++) {
        if (buffer[i] === 0) {
            return true;
        }
    }
    return false;
}

function nulRatioOnLane(bytes: Buffer, offset: 0 | 1): number {
    const sample = Math.min(bytes.length, 256);
    if (sample < 8) {
        return 0;
    }
    let nuls = 0;
    let count = 0;
    for (let i = offset; i < sample; i += 2) {
        count++;
        if (bytes[i] === 0) {
            nuls++;
        }
    }
    return count === 0 ? 0 : nuls / count;
}

function looksLikeUtf16Le(bytes: Buffer): boolean {
    return bytes.length >= 8
        && bytes.length % 2 === 0
        && nulRatioOnLane(bytes, 1) >= 0.6
        && nulRatioOnLane(bytes, 0) <= 0.4;
}

function looksLikeUtf16Be(bytes: Buffer): boolean {
    return bytes.length >= 8
        && bytes.length % 2 === 0
        && nulRatioOnLane(bytes, 0) >= 0.6
        && nulRatioOnLane(bytes, 1) <= 0.4;
}

function isWellFormedUtf8(bytes: Buffer): boolean {
    return Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes);
}

/**
 * Encoding is a restore/diff hint. Storage is always raw blob bytes (CP-07).
 * Binary and non-UTF-8 text must not be decoded as UTF-8.
 */
export function detectFileEncoding(filePath: string, bytes: Buffer): CheckpointContentEncoding {
    if (isBinarySnapshotExtension(filePath)) {
        return 'base64';
    }
    if (bytes.length === 0) {
        return 'utf8';
    }

    if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0xFE && bytes[3] === 0xFF) {
        return 'base64';
    }
    if (bytes.length >= 4 && bytes[0] === 0xFF && bytes[1] === 0xFE && bytes[2] === 0x00 && bytes[3] === 0x00) {
        return 'base64';
    }
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
        return 'utf16le';
    }
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
        return 'utf16be';
    }
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        return 'utf8';
    }

    if (looksLikeUtf16Le(bytes)) {
        return 'utf16le';
    }
    if (looksLikeUtf16Be(bytes)) {
        return 'utf16be';
    }
    if (isBinaryBuffer(bytes) || !isWellFormedUtf8(bytes)) {
        return 'base64';
    }
    return 'utf8';
}

export function classifyFileBuffer(
    filePath: string,
    buffer: Buffer,
    options: FileClassificationOptions,
): { content: string; encoding: CheckpointContentEncoding } | null {
    const encoding = detectFileEncoding(filePath, buffer);
    if (encoding === 'base64' && !options.captureBinaryFiles) {
        return null;
    }
    return {
        content: snapshotContentFromBytes(buffer, encoding),
        encoding,
    };
}

export function classificationOptionsFrom(host: FileClassificationOptions): FileClassificationOptions {
    return {
        captureBinaryFiles: host.captureBinaryFiles,
        extraTrackedExtensions: host.extraTrackedExtensions,
    };
}
