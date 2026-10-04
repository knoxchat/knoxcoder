import * as path from 'node:path';

import { withFileLock, type FileLockOptions } from 'core/util/fileLock';

export const STORE_LOCK_DIRNAME = '.store.lock';

/**
 * Serialize mutations of one checkpoint store across KnoxCoder windows that
 * share the same workspace store: manifest+blob writes, index writes, blob GC
 * and retention. Re-entrant within one call chain.
 */
export function withStoreLock<T>(
    storageRoot: string,
    fn: () => Promise<T>,
    options?: FileLockOptions,
): Promise<T> {
    return withFileLock(path.join(storageRoot, STORE_LOCK_DIRNAME), fn, options);
}
