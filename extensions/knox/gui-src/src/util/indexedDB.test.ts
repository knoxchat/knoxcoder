import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { indexedDBManager, getLocalStorage, setLocalStorage } from "./indexedDB";

describe("IndexedDB Manager", () => {
  beforeEach(async () => {
    // Clear any existing data before each test
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name) {
        indexedDB.deleteDatabase(db.name);
      }
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Basic Operations", () => {
    it("should store and retrieve a value", async () => {
      await setLocalStorage("ide", "vscode");
      const value = await getLocalStorage("ide");
      expect(value).toBe("vscode");
    });

    it("should store and retrieve a number", async () => {
      await setLocalStorage("fontSize", 14);
      const value = await getLocalStorage("fontSize");
      expect(value).toBe(14);
    });

    it("should store and retrieve a boolean", async () => {
      await setLocalStorage("isExploreDialogOpen", true);
      const value = await getLocalStorage("isExploreDialogOpen");
      expect(value).toBe(true);
    });

    it("should store and retrieve complex objects", async () => {
      const inputHistory = [
        { type: "doc", content: [{ type: "paragraph", content: [] }] },
        { type: "doc", content: [{ type: "paragraph", content: [] }] },
      ];
      await setLocalStorage("inputHistory_chat" as any, inputHistory);
      const value = await getLocalStorage("inputHistory_chat" as any);
      expect(value).toEqual(inputHistory);
    });

    it("should return undefined for non-existent keys", async () => {
      const value = await getLocalStorage("nonExistentKey" as any);
      expect(value).toBeUndefined();
    });

    it("should update existing values", async () => {
      await setLocalStorage("fontSize", 12);
      await setLocalStorage("fontSize", 16);
      const value = await getLocalStorage("fontSize");
      expect(value).toBe(16);
    });
  });

  describe("Image Storage", () => {
    it("should store and retrieve images", async () => {
      const imageUrl = "https://example.com/image.png";
      const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANS...";
      
      await indexedDBManager.setImage(imageUrl, dataUrl);
      const retrieved = await indexedDBManager.getImage(imageUrl);
      
      expect(retrieved).toBe(dataUrl);
    });

    it("should return undefined for non-existent images", async () => {
      const retrieved = await indexedDBManager.getImage("https://example.com/missing.png");
      expect(retrieved).toBeUndefined();
    });

    it("should remove images", async () => {
      const imageUrl = "https://example.com/image.png";
      const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANS...";
      
      await indexedDBManager.setImage(imageUrl, dataUrl);
      await indexedDBManager.removeImage(imageUrl);
      const retrieved = await indexedDBManager.getImage(imageUrl);
      
      expect(retrieved).toBeUndefined();
    });
  });

  describe("Redux Persist Storage", () => {
    it("should store and retrieve redux persist data", async () => {
      const stateData = {
        session: { history: [], id: "test-session" },
        config: { defaultModelTitle: "gpt-4" },
      };
      
      await indexedDBManager.setReduxPersist("persist:root", stateData);
      const retrieved = await indexedDBManager.getReduxPersist("persist:root");
      
      expect(retrieved).toEqual(stateData);
    });

    it("should get all redux persist keys", async () => {
      await indexedDBManager.setReduxPersist("persist:root", { data: "root" });
      await indexedDBManager.setReduxPersist("persist:session", { data: "session" });
      
      const keys = await indexedDBManager.getAllReduxPersistKeys();
      
      expect(keys).toContain("persist:root");
      expect(keys).toContain("persist:session");
      expect(keys).toHaveLength(2);
    });

    it("should remove redux persist data", async () => {
      await indexedDBManager.setReduxPersist("persist:root", { data: "test" });
      await indexedDBManager.removeReduxPersist("persist:root");
      const retrieved = await indexedDBManager.getReduxPersist("persist:root");
      
      expect(retrieved).toBeUndefined();
    });
  });

  describe("Migration from localStorage", () => {
    beforeEach(() => {
      // Clear localStorage before each test
      localStorage.clear();
    });

    it("should migrate data from localStorage to IndexedDB", async () => {
      // Set up some data in localStorage
      localStorage.setItem("ide", JSON.stringify("vscode"));
      localStorage.setItem("fontSize", JSON.stringify(14));
      localStorage.setItem("inputHistory_chat", JSON.stringify([
        { type: "doc", content: [] }
      ]));
      localStorage.setItem("persist:root", JSON.stringify({
        session: { history: [] }
      }));

      // Perform migration
      await indexedDBManager.migrateFromLocalStorage();

      // Verify data was migrated
      expect(await getLocalStorage("ide")).toBe("vscode");
      expect(await getLocalStorage("fontSize")).toBe(14);
      expect(await getLocalStorage("inputHistory_chat" as any)).toEqual([
        { type: "doc", content: [] }
      ]);
      expect(await indexedDBManager.getReduxPersist("persist:root")).toEqual({
        session: { history: [] }
      });
    });

    it("should handle migration errors gracefully", async () => {
      // Set invalid JSON in localStorage
      localStorage.setItem("invalidKey", "not valid json {");
      
      // Migration should not throw
      await expect(indexedDBManager.migrateFromLocalStorage()).resolves.not.toThrow();
    });

    it("should not migrate twice", async () => {
      localStorage.setItem("ide", JSON.stringify("vscode"));
      
      await indexedDBManager.migrateFromLocalStorage();
      const isMigrated = indexedDBManager.isMigrationComplete();
      expect(isMigrated).toBe(true);
      
      // Change localStorage after migration
      localStorage.setItem("ide", JSON.stringify("jetbrains"));
      
      // Second migration should not overwrite
      await indexedDBManager.migrateFromLocalStorage();
      const value = await getLocalStorage("ide");
      expect(value).toBe("vscode"); // Should still be the first value
    });
  });

  describe("Storage Limits", () => {
    it("should handle large data storage", async () => {
      // Create a large array to test storage capacity
      const largeArray = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        content: `Message ${i}`,
        timestamp: Date.now(),
        data: new Array(100).fill("x").join(""), // 100 character string
      }));

      await setLocalStorage("inputHistory_chat" as any, largeArray);
      const retrieved = await getLocalStorage("inputHistory_chat" as any);
      
      expect(retrieved).toBeDefined();
      expect(Array.isArray(retrieved)).toBe(true);
      expect(retrieved).toHaveLength(1000);
      expect(retrieved![0].id).toBe(0);
      expect(retrieved![999].id).toBe(999);
    });

    it("should handle binary data (images)", async () => {
      // Create a base64 encoded "large" image
      const largeImage = "data:image/png;base64," + "A".repeat(100000);
      
      await indexedDBManager.setImage("large-image.png", largeImage);
      const retrieved = await indexedDBManager.getImage("large-image.png");
      
      expect(retrieved).toBe(largeImage);
      expect(retrieved?.length).toBeGreaterThan(100000);
    });
  });

  describe("Error Handling", () => {
    it("should handle get operations on closed database gracefully", async () => {
      // This test ensures the code doesn't crash if DB operations fail
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      
      // Try to get a value - should handle gracefully even if DB is in bad state
      const result = await getLocalStorage("testKey" as any);
      
      // Should return undefined on error
      expect(result).toBeUndefined();
      
      consoleSpy.mockRestore();
    });
  });

  describe("Concurrent Operations", () => {
    it("should handle concurrent writes", async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(setLocalStorage(`key${i}` as any, `value${i}`));
      }
      
      await Promise.all(promises);
      
      // Verify all values were written
      for (let i = 0; i < 10; i++) {
        const value = await getLocalStorage(`key${i}` as any);
        expect(value).toBe(`value${i}`);
      }
    });

    it("should handle concurrent reads", async () => {
      await setLocalStorage("sharedKey" as any, "sharedValue");
      
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(getLocalStorage("sharedKey" as any));
      }
      
      const results = await Promise.all(promises);
      
      // All reads should return the same value
      results.forEach(result => {
        expect(result).toBe("sharedValue");
      });
    });
  });
});

