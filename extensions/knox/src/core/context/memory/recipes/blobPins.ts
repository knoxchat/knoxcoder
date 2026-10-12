/**
 * Recipe blob pinning (MC-12), core side.
 *
 * Returns a provider for the checkpoint store's GC (`host/checkpoints/store/blobPins.ts`)
 * so blobs named by live recipes survive count/age/quota eviction. The host
 * registers it; core never imports host code.
 */

import type { DatabaseConnection } from "../../../util/refreshIndex.js";
import { RecipeStore } from "./RecipeStore.js";

export const RECIPE_BLOB_PIN_PROVIDER = "recipes";

/**
 * Provider over any DB getter. Errors propagate on purpose: the checkpoint GC
 * treats a failing provider as "delete nothing".
 */
export function createRecipeBlobPinProvider(getDb: () => Promise<DatabaseConnection>) {
  return async (): Promise<string[]> => {
    const store = new RecipeStore(await getDb());
    return [...(await store.pinnedBlobRefCounts()).keys()];
  };
}
