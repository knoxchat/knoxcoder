import fs from "node:fs";
import * as path from "node:path";

import { runTests } from "@vscode/test-electron";
import { defaultConfig } from "core/config/default";
import * as YAML from "yaml";

export const testWorkspacePath = path.resolve(
  __dirname,
  "..",
  "src",
  "test",
  "fixtures",
  "test-workspace",
);

const knoxGlobalDir = path.resolve(
  __dirname,
  "..",
  "src",
  "test",
  "fixtures",
  ".knox",
);

function setupTestWorkspace() {
  if (fs.existsSync(testWorkspacePath)) {
    fs.rmSync(testWorkspacePath, { recursive: true });
  }
  fs.mkdirSync(testWorkspacePath, {
    recursive: true,
  });

  fs.writeFileSync(
    path.join(testWorkspacePath, "test.py"),
    "print('Hello World!')",
  );
  fs.writeFileSync(
    path.join(testWorkspacePath, "index.js"),
    "console.log('Hello World!')",
  );
  fs.writeFileSync(
    path.join(testWorkspacePath, "test.py"),
    "print('Hello World!')",
  );
  fs.mkdirSync(path.join(testWorkspacePath, "test-folder"));
  fs.writeFileSync(
    path.join(testWorkspacePath, "test-folder", "test.js"),
    "console.log('Hello World!')",
  );
}

function setupKnoxGlobalDir() {
  if (fs.existsSync(knoxGlobalDir)) {
    fs.rmSync(knoxGlobalDir, { recursive: true });
  }
  fs.mkdirSync(knoxGlobalDir, {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(knoxGlobalDir, "config.yaml"),
    YAML.stringify({
      ...defaultConfig,
      models: [
        {
          name: "Test Model",
          provider: "mock",
          model: "mock",
        },
      ],
    }),
  );
}

function cleanupTestWorkspace() {
  if (fs.existsSync(testWorkspacePath)) {
    fs.rmSync(testWorkspacePath, { recursive: true });
  }
}

function cleanupKnoxGlobalDir() {
  if (fs.existsSync(knoxGlobalDir)) {
    fs.rmSync(knoxGlobalDir, { recursive: true });
  }
}

async function main() {
  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`

    // Assumes this file is in out/runTestOnVSCodeHost.js
    const extensionDevelopmentPath = path.resolve(__dirname, "../");
    console.log("extensionDevelopmentPath", extensionDevelopmentPath);

    // The path to test runner
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(
      extensionDevelopmentPath,
      "out/mochaRunner",
    );

    const extensionTestsEnv = {
      NODE_ENV: "test",
      KNOX_GLOBAL_DIR: knoxGlobalDir,
      ...(process.env.MOCHA_GREP ? { MOCHA_GREP: process.env.MOCHA_GREP } : {}),
      ...(process.env.MOCHA_TIMEOUT ? { MOCHA_TIMEOUT: process.env.MOCHA_TIMEOUT } : {}),
    };

    setupTestWorkspace();
    setupKnoxGlobalDir();

    // Download VS Code, unzip it and run the integration test
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      extensionTestsEnv,
      launchArgs: [testWorkspacePath],
    });
  } catch (err) {
    console.error("Failed to run tests", err);
    process.exit(1);
  } finally {
    cleanupTestWorkspace();
    cleanupKnoxGlobalDir();
  }
}

main();
