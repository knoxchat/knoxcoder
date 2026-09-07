/**
 * IndexedDB Validation and Testing Utilities
 * 
 * Run these functions in the browser console to validate IndexedDB functionality
 * or call them programmatically during development.
 */

import { indexedDBManager, getLocalStorage, setLocalStorage } from "./indexedDB";

/**
 * Test basic read/write operations
 */
export async function testBasicOperations(): Promise<boolean> {
  console.log("[TEST] Testing basic IndexedDB operations...");
  
  try {
    // Test write
    await setLocalStorage("testKey" as any, "testValue");
    console.log("[OK] Write operation successful");
    
    // Test read
    const value = await getLocalStorage("testKey" as any) as any;
    if (value === "testValue") {
      console.log("[OK] Read operation successful");
    } else {
      console.error("[ERROR] Read operation failed - unexpected value:", value);
      return false;
    }
    
    // Test complex object
    const complexObj = { nested: { data: [1, 2, 3] }, timestamp: Date.now() };
    await setLocalStorage("complexTest" as any, complexObj);
    const retrieved = await getLocalStorage("complexTest" as any);
    if (JSON.stringify(retrieved) === JSON.stringify(complexObj)) {
      console.log("[OK] Complex object storage successful");
    } else {
      console.error("[ERROR] Complex object storage failed");
      return false;
    }
    
    console.log("[OK] All basic operations passed!");
    return true;
  } catch (error) {
    console.error("[ERROR] Basic operations test failed:", error);
    return false;
  }
}

/**
 * Test image storage
 */
export async function testImageStorage(): Promise<boolean> {
  console.log("[TEST] Testing image storage...");
  
  try {
    const testImageUrl = "https://test.example.com/image.png";
    const testDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    
    await indexedDBManager.setImage(testImageUrl, testDataUrl);
    console.log("[OK] Image write successful");
    
    const retrieved = await indexedDBManager.getImage(testImageUrl);
    if (retrieved === testDataUrl) {
      console.log("[OK] Image read successful");
      return true;
    } else {
      console.error("[ERROR] Image read failed - unexpected value");
      return false;
    }
  } catch (error) {
    console.error("[ERROR] Image storage test failed:", error);
    return false;
  }
}

/**
 * Test Redux persist storage
 */
export async function testReduxPersist(): Promise<boolean> {
  console.log("[TEST] Testing Redux persist storage...");
  
  try {
    const testState = {
      session: { history: [], id: "test-123" },
      config: { defaultModelTitle: "test-model" },
    };
    
    await indexedDBManager.setReduxPersist("persist:test", testState);
    console.log("[OK] Redux state write successful");
    
    const retrieved = await indexedDBManager.getReduxPersist("persist:test");
    if (JSON.stringify(retrieved) === JSON.stringify(testState)) {
      console.log("[OK] Redux state read successful");
      return true;
    } else {
      console.error("[ERROR] Redux state read failed");
      return false;
    }
  } catch (error) {
    console.error("[ERROR] Redux persist test failed:", error);
    return false;
  }
}

/**
 * Check storage quota and usage
 */
export async function checkStorageQuota(): Promise<void> {
  console.log("[INFO] Checking storage quota...");
  
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      const usedMB = ((estimate.usage || 0) / (1024 * 1024)).toFixed(2);
      const quotaMB = ((estimate.quota || 0) / (1024 * 1024)).toFixed(2);
      const percentUsed = estimate.quota ? ((estimate.usage || 0) / estimate.quota * 100).toFixed(2) : 0;
      
      console.log(`[INFO] Storage used: ${usedMB} MB`);
      console.log(`[INFO] Storage quota: ${quotaMB} MB`);
      console.log(`[INFO] Percentage used: ${percentUsed}%`);
      
      if (estimate.quota && estimate.usage) {
        const remainingMB = ((estimate.quota - estimate.usage) / (1024 * 1024)).toFixed(2);
        console.log(`[OK] Storage available: ${remainingMB} MB`);
      }
    } catch (error) {
      console.error("[ERROR] Failed to check storage quota:", error);
    }
  } else {
    console.warn("[WARN] Storage API not available in this browser");
  }
}

/**
 * Test migration from localStorage
 */
export async function testMigration(): Promise<boolean> {
  console.log("[TEST] Testing migration from localStorage...");
  
  try {
    // Set up test data in localStorage
    const testData = {
      "migrationTest": "success",
      "migrationNumber": 42,
      "migrationArray": [1, 2, 3],
    };
    
    for (const [key, value] of Object.entries(testData)) {
      localStorage.setItem(key, JSON.stringify(value));
    }
    
    console.log("[OK] Test data set in localStorage");
    
    // Note: In real scenario, migration happens automatically on app startup
    // This is just for testing the migration function
    await indexedDBManager.migrateFromLocalStorage();
    
    console.log("[OK] Migration completed");
    
    // Verify migrated data
    for (const [key, expectedValue] of Object.entries(testData)) {
      const value = await getLocalStorage(key as any);
      if (JSON.stringify(value) !== JSON.stringify(expectedValue)) {
        console.error(`[ERROR] Migration failed for key: ${key}`);
        return false;
      }
    }
    
    console.log("[OK] All data migrated successfully");
    return true;
  } catch (error) {
    console.error("[ERROR] Migration test failed:", error);
    return false;
  }
}

/**
 * Test concurrent operations
 */
export async function testConcurrentOperations(): Promise<boolean> {
  console.log("[TEST] Testing concurrent operations...");
  
  try {
    const operations = [];
    
    // Create 20 concurrent write operations
    for (let i = 0; i < 20; i++) {
      operations.push(setLocalStorage(`concurrent${i}` as any, `value${i}`));
    }
    
    await Promise.all(operations);
    console.log("[OK] Concurrent writes completed");
    
    // Verify all writes
    const verifications = [];
    for (let i = 0; i < 20; i++) {
      verifications.push(
        getLocalStorage(`concurrent${i}` as any).then(value => {
          if ((value as any) !== `value${i}`) {
            throw new Error(`Concurrent write verification failed for key concurrent${i}`);
          }
        })
      );
    }
    
    await Promise.all(verifications);
    console.log("[OK] Concurrent operations test passed");
    return true;
  } catch (error) {
    console.error("[ERROR] Concurrent operations test failed:", error);
    return false;
  }
}

/**
 * Test large data storage
 */
export async function testLargeDataStorage(): Promise<boolean> {
  console.log("[TEST] Testing large data storage...");
  
  try {
    // Create a large array (simulating extensive chat history)
    const largeArray = Array.from({ length: 500 }, (_, i) => ({
      id: i,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `This is message number ${i}. `.repeat(10), // ~300 chars per message
      timestamp: Date.now() - (500 - i) * 60000,
      metadata: {
        model: "gpt-4",
        tokens: Math.floor(Math.random() * 1000),
      }
    }));
    
    console.log(`[INFO] Creating array with ${largeArray.length} items...`);
    
    await setLocalStorage("largeDataTest" as any, largeArray);
    console.log("[OK] Large data write successful");
    
    const retrieved = await getLocalStorage("largeDataTest" as any);
    if (Array.isArray(retrieved) && retrieved.length === largeArray.length) {
      console.log(`[OK] Large data read successful (${retrieved.length} items)`);
      return true;
    } else {
      console.error("[ERROR] Large data read failed");
      return false;
    }
  } catch (error) {
    console.error("[ERROR] Large data storage test failed:", error);
    return false;
  }
}

/**
 * Run all validation tests
 */
export async function runAllTests(): Promise<void> {
  console.log("[INIT] Running all IndexedDB validation tests...\n");
  
  const results = {
    basicOperations: await testBasicOperations(),
    imageStorage: await testImageStorage(),
    reduxPersist: await testReduxPersist(),
    migration: await testMigration(),
    concurrentOps: await testConcurrentOperations(),
    largeData: await testLargeDataStorage(),
  };
  
  console.log("\n[INFO] Test Results Summary:");
  console.log("========================");
  
  let passedCount = 0;
  let totalCount = 0;
  
  for (const [testName, passed] of Object.entries(results)) {
    totalCount++;
    if (passed) passedCount++;
    console.log(`${passed ? "[OK]" : "[ERROR]"} ${testName}: ${passed ? "PASSED" : "FAILED"}`);
  }
  
  console.log("========================");
  console.log(`\n${passedCount}/${totalCount} tests passed`);
  
  if (passedCount === totalCount) {
    console.log("[OK] All tests passed! IndexedDB is working correctly.");
  } else {
    console.error("[ERROR] Some tests failed. Please check the logs above.");
  }
  
  // Check storage quota at the end
  console.log("\n");
  await checkStorageQuota();
}

// Export for browser console usage
if (typeof window !== "undefined") {
  (window as any).validateIndexedDB = {
    runAllTests,
    testBasicOperations,
    testImageStorage,
    testReduxPersist,
    testMigration,
    testConcurrentOperations,
    testLargeDataStorage,
    checkStorageQuota,
  };
  
  console.log("[TIP] IndexedDB validation utilities loaded!");
  console.log("[TIP] Run validateIndexedDB.runAllTests() to test all functionality");
  console.log("[TIP] Or run individual tests like validateIndexedDB.testBasicOperations()");
}

