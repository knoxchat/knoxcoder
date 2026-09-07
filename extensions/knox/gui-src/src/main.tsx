import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";

import App from "./App";
import "./index.css";
import { persistor, store } from "./redux/store";
import { initializeStorage } from "./util/indexedDB";
import "./i18n"; // Initialize i18n

(async () => {
  // Initialize IndexedDB and migrate data from localStorage
  try {
    console.log("[INIT] Initializing IndexedDB storage...");
    await initializeStorage();
    console.log("[OK] IndexedDB storage initialized successfully");
    
    // Load validation utilities in development mode
    if (import.meta.env.DEV) {
      import("./util/validateIndexedDB").then(() => {
        console.log("[TIP] IndexedDB validation utilities available in console");
        console.log("[TIP] Type: validateIndexedDB.runAllTests()");
      });
    }
  } catch (error) {
    console.error("[ERROR] Failed to initialize IndexedDB storage:", error);
    // Continue anyway - the app will fallback to localStorage if needed
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <Provider store={store}>
        <PersistGate loading={null} persistor={persistor}>
          <App />
        </PersistGate>
      </Provider>
    </React.StrictMode>,
  );
})();
