/**
 * Line blame / annotate (CP-44). Walk followed file history, reconstruct each
 * unique version, and attribute each current line to the newest checkpoint that
 * introduced it. Lexical LCS only — no embeddings.
 */

import * as fs from 'node:fs/promises';

import { createKnoxLogger } from 'core/util/knoxLog';

import { getBlob } from '../store/blobStore';
import { readBlobOptions } from './blobCrypto';
import { listFileCheckpointHistory } from './fileHistory';
import type { CheckpointEngineHost } from './host';
import { toPosixRelative } from './pathFilter';
import { getStoragePath } from './persistence';
import { reconstructStateAtCheckpoint } from './restore';
import type {
    BlameLine,
    BlameOptions,
    BlameRange,
    BlameResult,
    FileCheckpointVersion,
} from './types';
import { resolveWorkspaceRelativePath } from './workspace';

const log = createKnoxLogger('Checkpoints');

export interface BlameVersion {
    checkpointId: string;
    label?: string;
    description: string;
    originPath: string;
    lines: string[] | null;
}

function splitLines(text: string): string[] {
    if (text.length === 0) {
        return [];
    }
    const lines = text.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
}

function lcsTable(a: string[], b: string[]): Uint32Array[] {
    const rows: Uint32Array[] = [new Uint32Array(b.length + 1)];
    for (let i = 1; i <= a.length; i++) {
        const prev = rows[i - 1];
        const next = new Uint32Array(b.length + 1);
        for (let j = 1; j <= b.length; j++) {
            next[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], next[j - 1]);
        }
        rows.push(next);
    }
    return rows;
}

/** Map each line of `b` to the matching index in `a`, or undefined if it is new. */
export function alignBToA(a: string[] | null, b: string[] | null): Array<number | undefined> {
    if (!b) {
        return [];
    }
    const mapped: Array<number | undefined> = new Array(b.length);
    if (!a || a.length === 0 || b.length === 0) {
        return mapped;
    }
    const table = lcsTable(a, b);
    let i = a.length;
    let j = b.length;
    while (i > 0 && j > 0) {
        if (a[i - 1] === b[j - 1]) {
            mapped[j - 1] = i - 1;
            i -= 1;
            j -= 1;
            continue;
        }
        if (table[i][j - 1] >= table[i - 1][j]) {
            j -= 1;
        } else {
            i -= 1;
        }
    }
    return mapped;
}

/**
 * Attribute each current line to the newest version that introduced it.
 * A version with `lines: null` (missing blob) is a break — those lines stay unknown.
 */
export function attributeLines(current: string[], versions: BlameVersion[]): BlameLine[] {
    const contents: Array<string[] | null> = [...versions.map((version) => version.lines), current];
    const alignments: Array<Array<number | undefined>> = [];
    for (let i = 0; i < contents.length - 1; i++) {
        alignments.push(alignBToA(contents[i], contents[i + 1]));
    }

    return current.map((text, j) => {
        let idx = j;
        let origin = versions.length;
        for (let step = alignments.length - 1; step >= 0; step--) {
            const prev = alignments[step][idx];
            if (prev === undefined) {
                origin = step + 1;
                break;
            }
            idx = prev;
            if (step === 0) {
                origin = 0;
            }
        }
        if (origin >= versions.length) {
            return { line: j + 1, text };
        }
        const version = versions[origin];
        if (!version.lines) {
            return { line: j + 1, text };
        }
        return {
            line: j + 1,
            text,
            checkpointId: version.checkpointId,
            label: version.label,
            description: version.description,
            originPath: version.originPath,
        };
    });
}

export function collapseBlameRanges(lines: BlameLine[]): BlameRange[] {
    const ranges: BlameRange[] = [];
    for (const entry of lines) {
        const last = ranges[ranges.length - 1];
        if (
            last
            && last.checkpointId === entry.checkpointId
            && last.originPath === entry.originPath
            && last.endLine === entry.line - 1
        ) {
            last.endLine = entry.line;
            continue;
        }
        ranges.push({
            startLine: entry.line,
            endLine: entry.line,
            checkpointId: entry.checkpointId,
            label: entry.label,
            description: entry.description,
            originPath: entry.originPath,
        });
    }
    return ranges;
}

async function textFromHash(
    host: CheckpointEngineHost,
    hash: string | undefined,
): Promise<string | undefined> {
    if (!hash) {
        return undefined;
    }
    try {
        const bytes = await getBlob(getStoragePath(host), hash, await readBlobOptions(host));
        if (bytes.includes(0)) {
            return undefined;
        }
        return bytes.toString('utf8');
    } catch {
        return undefined;
    }
}

async function currentFileText(
    host: CheckpointEngineHost,
    relativePath: string,
    atCheckpointId: string | undefined,
    versions: FileCheckpointVersion[],
): Promise<{ text: string; unsupported?: BlameResult['unsupported'] }> {
    if (atCheckpointId) {
        const state = await reconstructStateAtCheckpoint(host, atCheckpointId);
        if (!state) {
            return { text: '', unsupported: 'missing' };
        }
        const originPath = versions.find((version) => version.checkpointId === atCheckpointId)?.relativePath
            ?? relativePath;
        const resolved = state.get(originPath) ?? state.get(relativePath);
        if (!resolved) {
            return { text: '' };
        }
        if (resolved.content.includes('\0')) {
            return { text: '', unsupported: 'binary' };
        }
        return { text: resolved.content };
    }

    const sandboxed = resolveWorkspaceRelativePath(host, relativePath);
    if (!sandboxed.ok) {
        return { text: '' };
    }
    try {
        const bytes = await fs.readFile(sandboxed.fullPath);
        if (bytes.includes(0)) {
            return { text: '', unsupported: 'binary' };
        }
        return { text: bytes.toString('utf8') };
    } catch {
        return { text: '', unsupported: 'missing' };
    }
}

function versionsUpTo(
    versions: FileCheckpointVersion[],
    atCheckpointId: string | undefined,
    history: Array<{ id: string; created: Date }>,
): FileCheckpointVersion[] {
    if (!atCheckpointId) {
        return versions;
    }
    const at = history.find((checkpoint) => checkpoint.id === atCheckpointId);
    if (!at) {
        return versions;
    }
    const cutoff = at.created instanceof Date ? at.created.getTime() : new Date(at.created).getTime();
    return versions.filter((version) => {
        const created = version.created instanceof Date ? version.created.getTime() : new Date(version.created).getTime();
        return created <= cutoff;
    });
}

export async function blameFile(
    host: CheckpointEngineHost,
    relativePath: string,
    options?: BlameOptions,
): Promise<BlameResult> {
    await host.whenReady();
    const posixPath = toPosixRelative(relativePath);
    if (!host.initialized || !host.currentWorkspacePath || !posixPath) {
        return { relativePath: posixPath || relativePath, atCheckpointId: options?.atCheckpointId, lines: [] };
    }

    const sandboxed = resolveWorkspaceRelativePath(host, posixPath);
    if (!sandboxed.ok) {
        return { relativePath: posixPath, atCheckpointId: options?.atCheckpointId, lines: [] };
    }

    const allVersions = await listFileCheckpointHistory(host, posixPath);
    const versions = versionsUpTo(allVersions, options?.atCheckpointId, host.checkpointHistory);
    const current = await currentFileText(host, posixPath, options?.atCheckpointId, versions);
    if (current.unsupported) {
        return {
            relativePath: posixPath,
            atCheckpointId: options?.atCheckpointId,
            unsupported: current.unsupported,
            lines: [],
        };
    }

    const reconstructed: BlameVersion[] = [];
    for (const version of versions) {
        if (version.deleted) {
            continue;
        }
        const text = await textFromHash(host, version.hash);
        const info = host.checkpointHistory.find((checkpoint) => checkpoint.id === version.checkpointId);
        reconstructed.push({
            checkpointId: version.checkpointId,
            label: info?.label,
            description: version.description,
            originPath: version.relativePath,
            lines: text === undefined ? null : splitLines(text),
        });
    }

    const lines = attributeLines(splitLines(current.text), reconstructed);
    log.debug(`Blamed ${posixPath} (${lines.length} lines, ${reconstructed.length} versions)`);
    return {
        relativePath: posixPath,
        atCheckpointId: options?.atCheckpointId,
        lines,
    };
}
