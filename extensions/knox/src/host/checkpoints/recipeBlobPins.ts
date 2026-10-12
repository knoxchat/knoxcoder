import { get as getBrainDb } from 'core/context/memory/brain/store/connection';
import {
    RECIPE_BLOB_PIN_PROVIDER,
    createRecipeBlobPinProvider,
} from 'core/context/memory/recipes/blobPins';

import { registerBlobPinProvider } from './store/blobPins';

/**
 * Protect blobs named by live recipes from checkpoint GC (MC-12). Call once
 * before any recipe is captured (MC-14), when `knoxchat.recipes.enabled` is on.
 * Returns an unregister function.
 */
export function registerRecipeBlobPins(): () => void {
    return registerBlobPinProvider(RECIPE_BLOB_PIN_PROVIDER, createRecipeBlobPinProvider(getBrainDb));
}
