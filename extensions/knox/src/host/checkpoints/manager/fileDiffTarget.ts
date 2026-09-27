import type { CheckpointDiffResult, CheckpointFileDiff } from './types';

export type CheckpointFileDiffSelection =
    | { ok: true; file: CheckpointFileDiff }
    | { ok: false; error: 'noSnapshots' | 'noOriginalContent' };

function samePath(left: string, right: string): boolean {
    return left.replace(/\\/g, '/').replace(/^\.\//, '') === right.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Pick one file out of a computed checkpoint diff.
 * A missing diff is "no snapshots". A path with no stored blob is "no original content".
 * Those are the existing warning keys; callers show them and do not invent another.
 */
export function selectCheckpointFileDiff(
    diff: CheckpointDiffResult | null,
    relativePath: string,
): CheckpointFileDiffSelection {
    if (!diff) {
        return { ok: false, error: 'noSnapshots' };
    }
    const file = diff.files.find((entry) => samePath(entry.relativePath, relativePath));
    if (!file || (file.oldContent == null && file.newContent == null)) {
        return { ok: false, error: 'noOriginalContent' };
    }
    return { ok: true, file };
}
