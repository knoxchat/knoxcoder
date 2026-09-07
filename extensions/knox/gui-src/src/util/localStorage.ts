/**
 * Storage utility - now uses IndexedDB instead of localStorage
 * 
 * This file maintains backward compatibility by exporting the same functions,
 * but now they use IndexedDB for unlimited storage capacity.
 */

export { 
  getLocalStorage, 
  setLocalStorage,
  getLocalStorageSync,
  setLocalStorageSync,
  LocalStorageKey,
  LOCAL_STORAGE_CHANGED_EVENT,
  initializeStorage,
  indexedDBManager,
} from "./indexedDB";
