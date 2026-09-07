/**
 * IndexedDB Storage Adapter for Redux Persist
 * 
 * This adapter allows redux-persist to use IndexedDB instead of localStorage,
 * providing much larger storage capacity (no 5MB limit).
 */

import { indexedDBManager } from "./indexedDB";

/**
 * Create an IndexedDB storage engine for redux-persist
 */
export function createIndexedDBStorage() {
  return {
    /**
     * Get an item from IndexedDB
     */
    getItem: async (key: string): Promise<string | null> => {
      try {
        const value = await indexedDBManager.getReduxPersist(key);
        if (value === undefined) {
          return null;
        }
        // redux-persist expects a string, so serialize if needed
        return typeof value === "string" ? value : JSON.stringify(value);
      } catch (error) {
        console.error(`Error getting item "${key}" from IndexedDB:`, error);
        return null;
      }
    },

    /**
     * Set an item in IndexedDB
     */
    setItem: async (key: string, value: string): Promise<void> => {
      try {
        // Try to parse the value, but store as-is if parsing fails
        let parsedValue: any;
        try {
          parsedValue = JSON.parse(value);
        } catch {
          parsedValue = value;
        }
        await indexedDBManager.setReduxPersist(key, parsedValue);
      } catch (error) {
        console.error(`Error setting item "${key}" in IndexedDB:`, error);
        throw error;
      }
    },

    /**
     * Remove an item from IndexedDB
     */
    removeItem: async (key: string): Promise<void> => {
      try {
        await indexedDBManager.removeReduxPersist(key);
      } catch (error) {
        console.error(`Error removing item "${key}" from IndexedDB:`, error);
        throw error;
      }
    },

    /**
     * Get all keys (optional, but useful for debugging)
     */
    getAllKeys: async (): Promise<string[]> => {
      try {
        return await indexedDBManager.getAllReduxPersistKeys();
      } catch (error) {
        console.error("Error getting all keys from IndexedDB:", error);
        return [];
      }
    },
  };
}

/**
 * Export a singleton instance for use in redux store configuration
 */
export const indexedDBStorage = createIndexedDBStorage();

