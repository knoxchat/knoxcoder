/**
 * Extra blob references that must survive garbage collection (MC-12).
 *
 * Retention evicts whole checkpoints, and GC then frees every blob no manifest
 * names. Recipes need specific blobs to outlive the checkpoint that captured
 * them, without pinning the whole checkpoint. A provider returns hashes that
 * are still wanted; `collectReferencedBlobHashes` unions them with manifest refs.
 *
 * Providers are injected (not imported) so the checkpoint store never opens the
 * memory database on its own. A provider that throws makes GC delete nothing:
 * freeing a blob a recipe needs is worse than keeping an orphan.
 */

export type BlobPinProvider = () => Promise<Iterable<string>> | Iterable<string>;

const providers = new Map<string, BlobPinProvider>();

/** Register (or replace) a provider by name. Returns an unregister function. */
export function registerBlobPinProvider(name: string, provider: BlobPinProvider): () => void {
    providers.set(name, provider);
    return () => {
        if (providers.get(name) === provider) {
            providers.delete(name);
        }
    };
}

/** Union of all provider hashes. Rejects if any provider fails (callers must fail closed). */
export async function collectPinnedBlobHashes(): Promise<Set<string>> {
    const pinned = new Set<string>();
    for (const provider of providers.values()) {
        for (const hash of await provider()) {
            pinned.add(hash);
        }
    }
    return pinned;
}
