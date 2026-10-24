import { get as getBrainDb } from 'core/context/memory/brain/store/connection';
import {
    RECIPE_BLOB_PIN_PROVIDER,
    createRecipeBlobPinProvider,
} from 'core/context/memory/recipes/blobPins';

import { registerBlobPinProvider } from './store/blobPins';

/**
 * Protect blobs named by live recipes from checkpoint GC (MC-12). Call at host
 * init when `knoxchat.recipes.enabled` is on (T5), and again on capture/replay
 * (idempotent: the provider is keyed by name). Returns an unregister function.
 */
export function registerRecipeBlobPins(): () => void {
    return registerBlobPinProvider(RECIPE_BLOB_PIN_PROVIDER, createRecipeBlobPinProvider(getBrainDb));
}
