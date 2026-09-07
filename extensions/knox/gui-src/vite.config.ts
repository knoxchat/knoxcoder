import path from "path"
import { fileURLToPath } from "url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const knoxRoot = path.resolve(rootDir, "..");
const emptyNode = path.resolve(rootDir, "./src/util/emptyNodeModule.ts");

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative URLs so VS Code webview asWebviewUri(gui/assets/index.js) can
  // load sibling chunks and ../fonts without a localhost origin.
  base: "./",
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(rootDir, "./src") },
      { find: /^core$/, replacement: path.join(knoxRoot, "core", "index.d.ts") },
      { find: /^core\//, replacement: path.join(knoxRoot, "core") + "/" },
      { find: /^knoxdev-package\/config-yaml$/, replacement: path.join(knoxRoot, "knoxdev-package", "src", "config-yaml", "index.ts") },
      { find: /^knoxdev-package\/fetch$/, replacement: path.join(knoxRoot, "knoxdev-package", "src", "fetch", "index.ts") },
      { find: /^knoxdev-package\/openai-adapters$/, replacement: path.join(knoxRoot, "knoxdev-package", "src", "openai-adapters", "index.ts") },
      { find: /^knoxdev-package\/openai-adapters\//, replacement: path.join(knoxRoot, "knoxdev-package", "src", "openai-adapters") + "/" },
      { find: "sqlite3", replacement: emptyNode },
      { find: "node-pty", replacement: emptyNode },
    ],
  },
  optimizeDeps: {
    exclude: ["sqlite3", "node-pty"],
  },
  define: {
    // Define global variables for browser environment
    global: 'globalThis',
  },
  build: {
    outDir: path.join(knoxRoot, "gui"),
    emptyOutDir: true,
    // VS Code webviews cannot preload split CSS (absolute /assets/*.css URLs
    // resolve to file+.vscode-resource.vscode-cdn.net/assets/... and throw
    // "Unable to preload CSS"). Keep one stylesheet, referenced from HTML.
    cssCodeSplit: false,
    modulePreload: false,
    // Change the output .js filename to not include a hash
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: (assetInfo) => {
          const name = assetInfo.names?.[0] ?? assetInfo.name ?? "";
          if (name.endsWith(".css")) {
            return "assets/index.css";
          }
          return "assets/[name].[ext]";
        },
      },
    },
  },
  server: {
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["*", "Content-Type", "Authorization"],
      credentials: true,
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/util/test/setupTests.ts",
  },
});
