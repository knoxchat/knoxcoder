import { JSONContent } from "@tiptap/react";

/**
 * IndexedDB Database Configuration
 */
const DB_NAME = "knoxchat_storage";
const DB_VERSION = 1;

/**
 * Store Names
 */
const STORES = {
  KEY_VALUE: "keyValueStore", // General key-value storage
  IMAGES: "imageStore", // Image cache storage
  REDUX_PERSIST: "reduxPersist", // Redux persist storage
} as const;

type StoreNames = (typeof STORES)[keyof typeof STORES];

/**
 * Type definitions for stored data
 */
type LocalStorageTypes = {
  isExploreDialogOpen: boolean;
  hasDismissedExploreDialog: boolean;
  gitDiffPanelExpanded: boolean;
  jobsPanelExpanded: boolean;
  activityPanelExpanded: boolean;
  mainTextEntryCounter: number;
  ide: "vscode";
  ftc: number;
  fontSize: number;
  [key: `inputHistory_${string}`]: JSONContent[];
  extensionVersion: string;
  shownProfilesIntroduction: boolean;
  seenHubIntro: boolean;
  "checkpoint-file-tree-width": string | number;
  "knoxchat-file-tree-expanded": boolean | string;
  "knoxchat-diff-tree-expanded": boolean | string;
  reasoningEffort?: string;
  reasoningEffortByModel: Record<string, string>;
  [key: string]: any; // Allow any string key for flexibility
};

export enum LocalStorageKey {
  IsExploreDialogOpen = "isExploreDialogOpen",
  HasDismissedExploreDialog = "hasDismissedExploreDialog",
  GitDiffPanelExpanded = "gitDiffPanelExpanded",
  JobsPanelExpanded = "jobsPanelExpanded",
  ActivityPanelExpanded = "activityPanelExpanded",
  ReasoningEffort = "reasoningEffort",
  ReasoningEffortByModel = "reasoningEffortByModel",
}

/**
 * IndexedDB Manager Class
 */
class IndexedDBManager {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private migrationComplete = false;

  /**
   * Initialize the database
   */
  private async initDB(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error("Failed to open IndexedDB:", request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        const db = request.result;
        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create stores if they don't exist
        if (!db.objectStoreNames.contains(STORES.KEY_VALUE)) {
          db.createObjectStore(STORES.KEY_VALUE);
        }

        if (!db.objectStoreNames.contains(STORES.IMAGES)) {
          db.createObjectStore(STORES.IMAGES);
        }

        if (!db.objectStoreNames.contains(STORES.REDUX_PERSIST)) {
          db.createObjectStore(STORES.REDUX_PERSIST);
        }
      };
    });

    return this.dbPromise;
  }

  /**
   * Get a value from the specified store
   */
  private async get<T = any>(
    storeName: StoreNames,
    key: string,
  ): Promise<T | undefined> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const request = store.get(key);

      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error(`Error getting key "${key}" from "${storeName}":`, error);
      return undefined;
    }
  }

  /**
   * Set a value in the specified store
   */
  private async set<T = any>(
    storeName: StoreNames,
    key: string,
    value: T,
  ): Promise<void> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.put(value, key);

      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error(`Error setting key "${key}" in "${storeName}":`, error);
      throw error;
    }
  }

  /**
   * Remove a value from the specified store
   */
  private async remove(storeName: StoreNames, key: string): Promise<void> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);

      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error(
        `Error removing key "${key}" from "${storeName}":`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get all keys from the specified store
   */
  private async getAllKeys(storeName: StoreNames): Promise<string[]> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const request = store.getAllKeys();

      return new Promise((resolve, reject) => {
        request.onsuccess = () =>
          resolve(request.result.map((key) => String(key)));
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error(`Error getting all keys from "${storeName}":`, error);
      return [];
    }
  }

  /**
   * Clear all data from the specified store
   */
  private async clearStore(storeName: StoreNames): Promise<void> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.clear();

      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error(`Error clearing store "${storeName}":`, error);
      throw error;
    }
  }

  // ============================================
  // Public API: Key-Value Storage (replaces localStorage)
  // ============================================

  /**
   * Get a value from key-value store
   */
  async getItem<T extends keyof LocalStorageTypes>(
    key: T,
  ): Promise<LocalStorageTypes[T] | undefined> {
    return this.get(STORES.KEY_VALUE, String(key));
  }

  /**
   * Set a value in key-value store
   */
  async setItem<T extends keyof LocalStorageTypes>(
    key: T,
    value: LocalStorageTypes[T],
  ): Promise<void> {
    return this.set(STORES.KEY_VALUE, String(key), value);
  }

  /**
   * Remove a value from key-value store
   */
  async removeItem<T extends keyof LocalStorageTypes>(
    key: T,
  ): Promise<void> {
    return this.remove(STORES.KEY_VALUE, String(key));
  }

  /**
   * Get all keys from key-value store
   */
  async keys(): Promise<string[]> {
    return this.getAllKeys(STORES.KEY_VALUE);
  }

  /**
   * Clear all key-value data
   */
  async clear(): Promise<void> {
    return this.clearStore(STORES.KEY_VALUE);
  }

  // ============================================
  // Public API: Image Storage
  // ============================================

  /**
   * Get a cached image
   */
  async getImage(url: string): Promise<string | undefined> {
    return this.get(STORES.IMAGES, url);
  }

  /**
   * Cache an image
   */
  async setImage(url: string, dataUrl: string): Promise<void> {
    return this.set(STORES.IMAGES, url, dataUrl);
  }

  /**
   * Remove a cached image
   */
  async removeImage(url: string): Promise<void> {
    return this.remove(STORES.IMAGES, url);
  }

  /**
   * Clear all cached images
   */
  async clearImages(): Promise<void> {
    return this.clearStore(STORES.IMAGES);
  }

  // ============================================
  // Public API: Redux Persist Storage
  // ============================================

  /**
   * Get redux persist data
   */
  async getReduxPersist(key: string): Promise<any> {
    return this.get(STORES.REDUX_PERSIST, key);
  }

  /**
   * Set redux persist data
   */
  async setReduxPersist(key: string, value: any): Promise<void> {
    return this.set(STORES.REDUX_PERSIST, key, value);
  }

  /**
   * Remove redux persist data
   */
  async removeReduxPersist(key: string): Promise<void> {
    return this.remove(STORES.REDUX_PERSIST, key);
  }

  /**
   * Get all redux persist keys
   */
  async getAllReduxPersistKeys(): Promise<string[]> {
    return this.getAllKeys(STORES.REDUX_PERSIST);
  }

  // ============================================
  // Migration from localStorage
  // ============================================

  /**
   * Migrate data from localStorage to IndexedDB
   */
  async migrateFromLocalStorage(): Promise<void> {
    if (this.migrationComplete) {
      return;
    }

    console.log("[MIGRATE] Starting migration from localStorage to IndexedDB...");

    try {
      // Migrate key-value data
      const keysToMigrate: string[] = [
        "isExploreDialogOpen",
        "hasDismissedExploreDialog",
        "mainTextEntryCounter",
        "ide",
        "ftc",
        "fontSize",
        "extensionVersion",
        "shownProfilesIntroduction",
        "seenHubIntro",
        "checkpoint-file-tree-width",
        "knoxchat-file-tree-expanded",
        "knoxchat-diff-tree-expanded",
      ];

      // Also migrate inputHistory_ keys
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("inputHistory_")) {
          keysToMigrate.push(key);
        }
      }

      // Migrate each key
      for (const key of keysToMigrate) {
        const value = localStorage.getItem(key);
        if (value !== null) {
          try {
            const parsed = JSON.parse(value);
            await this.set(STORES.KEY_VALUE, key, parsed);
          } catch {
            // If not JSON, store as string
            await this.set(STORES.KEY_VALUE, key, value);
          }
        }
      }

      // Migrate redux-persist data
      const persistRoot = localStorage.getItem("persist:root");
      if (persistRoot) {
        await this.setReduxPersist("persist:root", JSON.parse(persistRoot));
      }

      // Migrate image cache (look for data: URLs)
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("data:") || (key && key.startsWith("http"))) {
          const value = localStorage.getItem(key);
          if (value) {
            await this.setImage(key, value);
          }
        }
      }

      this.migrationComplete = true;
      console.log("[OK] Migration from localStorage to IndexedDB completed successfully");

      // Optional: Clear localStorage after successful migration
      // Uncomment the following lines if you want to clean up localStorage
      // console.log("[CLEANUP] Cleaning up localStorage...");
      // localStorage.clear();
    } catch (error) {
      console.error("[ERROR] Error during migration from localStorage:", error);
      throw error;
    }
  }

  /**
   * Check if migration has been completed
   */
  isMigrationComplete(): boolean {
    return this.migrationComplete;
  }
}

// Export singleton instance
export const indexedDBManager = new IndexedDBManager();

// ============================================
// Convenience Functions (replaces localStorage.ts exports)
// ============================================

/**
 * Get a value from IndexedDB (async version of getLocalStorage)
 * Overloaded to support both strict typing and flexible 'any' usage
 */
export async function getLocalStorage<T extends keyof LocalStorageTypes>(
  key: T,
): Promise<LocalStorageTypes[T] | undefined>;
export async function getLocalStorage(key: any): Promise<any>;
export async function getLocalStorage<T extends keyof LocalStorageTypes>(
  key: T | any,
): Promise<LocalStorageTypes[T] | any | undefined> {
  try {
    const value = await indexedDBManager.getItem(key);
    return value;
  } catch (error) {
    console.error(
      `Error getting ${String(key)} from IndexedDB\n\n`,
      error,
    );
    return undefined;
  }
}

export const LOCAL_STORAGE_CHANGED_EVENT = "knoxLocalStorageChanged";

const syncCache = new Map<string, any>();

function notifyLocalStorageChanged(key: string, value: any) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(LOCAL_STORAGE_CHANGED_EVENT, {
      detail: { key, value },
    }),
  );
}

/**
 * Set a value in IndexedDB (async version of setLocalStorage)
 * Overloaded to support both strict typing and flexible 'any' usage
 */
export async function setLocalStorage<T extends keyof LocalStorageTypes>(
  key: T,
  value: LocalStorageTypes[T],
): Promise<void>;
export async function setLocalStorage(key: any, value: any): Promise<void>;
export async function setLocalStorage<T extends keyof LocalStorageTypes>(
  key: T | any,
  value: LocalStorageTypes[T] | any,
): Promise<void> {
  const keyStr = String(key);
  syncCache.set(keyStr, value);
  localStorage.setItem(keyStr, JSON.stringify(value));
  notifyLocalStorageChanged(keyStr, value);
  await indexedDBManager.setItem(key, value);
}

/**
 * Synchronous getter with cache (for backward compatibility where sync is needed)
 * Note: This should be avoided where possible, prefer async versions
 * Overloaded to support both strict typing and flexible 'any' usage
 */
export function getLocalStorageSync<T extends keyof LocalStorageTypes>(
  key: T,
): LocalStorageTypes[T] | undefined;
export function getLocalStorageSync(key: any): any;
export function getLocalStorageSync<T extends keyof LocalStorageTypes>(
  key: T | any,
): LocalStorageTypes[T] | any | undefined {
  const keyStr = String(key);
  
  // Return from cache if available
  if (syncCache.has(keyStr)) {
    return syncCache.get(keyStr);
  }

  // Fallback to localStorage for immediate availability
  const lsValue = localStorage.getItem(keyStr);
  if (lsValue !== null) {
    try {
      const parsed = JSON.parse(lsValue);
      syncCache.set(keyStr, parsed);
      return parsed;
    } catch {
      return lsValue as any;
    }
  }

  // Load from IndexedDB and cache for next time
  indexedDBManager.getItem(key).then((value) => {
    if (value !== undefined) {
      syncCache.set(keyStr, value);
    }
  });

  return undefined;
}

/**
 * Synchronous setter with cache
 * Overloaded to support both strict typing and flexible 'any' usage
 */
export function setLocalStorageSync<T extends keyof LocalStorageTypes>(
  key: T,
  value: LocalStorageTypes[T],
): void;
export function setLocalStorageSync(key: any, value: any): void;
export function setLocalStorageSync<T extends keyof LocalStorageTypes>(
  key: T | any,
  value: LocalStorageTypes[T] | any,
): void {
  const keyStr = String(key);
  syncCache.set(keyStr, value);
  // Also save to localStorage as backup
  localStorage.setItem(keyStr, JSON.stringify(value));
  notifyLocalStorageChanged(keyStr, value);
  // Async save to IndexedDB
  indexedDBManager.setItem(key, value).catch((error) => {
    console.error(`Error saving ${keyStr} to IndexedDB:`, error);
  });
}

/**
 * Initialize IndexedDB and perform migration
 */
export async function initializeStorage(): Promise<void> {
  await indexedDBManager.migrateFromLocalStorage();
}

