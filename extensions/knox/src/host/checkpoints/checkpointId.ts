import { randomUUID } from 'node:crypto';

const CHECKPOINT_ID_PREFIX = 'cp_';
const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Cryptographically unique checkpoint id. Prefix is kept for log grepping.
 * Legacy ids (`cp_<timestamp>_<rand>`) remain readable; new ids are UUID-based.
 */
export function generateCheckpointId(): string {
    return `${CHECKPOINT_ID_PREFIX}${randomUUID()}`;
}

export function isCheckpointId(value: string): boolean {
    if (typeof value !== 'string' || !value.startsWith(CHECKPOINT_ID_PREFIX)) {
        return false;
    }
    const rest = value.slice(CHECKPOINT_ID_PREFIX.length);
    return UUID_RE.test(rest);
}
