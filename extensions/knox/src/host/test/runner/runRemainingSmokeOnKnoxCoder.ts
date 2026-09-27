import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { defaultConfig } from "core/config/default";
import * as YAML from "yaml";

/**
 * KN-144 remaining ticks against KnoxCoder (builtin vscode.knox), not stock
 * VS Code from @vscode/test-electron.
 *
 * Launches the source Electron with a throwaway git workspace + mock model.
 */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (
      fs.existsSync(path.join(dir, "product.json")) &&
      fs.existsSync(path.join(dir, "extensions", "knox", "package.json"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error(`Could not find KnoxCoder repo root from ${start}`);
}

const repoRoot = findRepoRoot(__dirname);
const extensionRoot = path.join(repoRoot, "extensions", "knox");

function knoxCoderElectron(): string {
  if (process.env.INTEGRATION_TEST_ELECTRON_PATH) {
    return process.env.INTEGRATION_TEST_ELECTRON_PATH;
  }
  if (process.platform === "darwin") {
    return path.join(
      repoRoot,
      ".build/electron/KnoxCoder.app/Contents/MacOS/KnoxCoder",
    );
  }
  if (process.platform === "win32") {
    return path.join(repoRoot, ".build/electron/KnoxCoder.exe");
  }
  return path.join(repoRoot, ".build/electron/knoxcoder");
}

function setupWorkspace(): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "knox-remaining-smoke-"));
  fs.writeFileSync(path.join(workspace, "index.js"), "console.log('Hello World!')\n");
  fs.writeFileSync(path.join(workspace, "app.js"), "hello\n");
  const { execSync } = require("node:child_process") as typeof import("node:child_process");
  execSync("git init -b main", { cwd: workspace });
  execSync("git config user.name knox-smoke", { cwd: workspace });
  execSync("git config user.email knox-smoke@example.com", { cwd: workspace });
  execSync("git config commit.gpgsign false", { cwd: workspace });
  execSync("git add .", { cwd: workspace });
  execSync('git commit -m "initial smoke commit"', { cwd: workspace });
  return workspace;
}

function setupKnoxGlobalDir(): string {
  const knoxDir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-global-smoke-"));
  fs.writeFileSync(
    path.join(knoxDir, "config.yaml"),
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
  return knoxDir;
}

async function main() {
  const electronPath = knoxCoderElectron();
  if (!fs.existsSync(electronPath)) {
    console.error(`KnoxCoder Electron not found at ${electronPath}`);
    console.error("Run scripts/code.sh once (or gulp electron) so .build/electron exists.");
    process.exit(1);
  }

  const workspace = setupWorkspace();
  const knoxGlobalDir = setupKnoxGlobalDir();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-smoke-user-"));
  const crashDir = path.join(repoRoot, ".build/crashes");
  const logsDir = path.join(repoRoot, ".build/logs/knox-remaining-smoke");
  fs.mkdirSync(crashDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  const extensionDevelopmentPath = extensionRoot;
  const extensionTestsPath = path.join(__dirname, "remainingSmokeRunner");
  // Electron app is this repo (same as scripts/code.sh). Tests live under
  // extensions/knox/src/host — VS Code requires extensionDevelopmentPath together
  // with extensionTestsPath or the runner never starts.
  const args = [
    repoRoot,
    workspace,
    `--extensionDevelopmentPath=${extensionDevelopmentPath}`,
    `--extensionTestsPath=${extensionTestsPath}`,
    `--user-data-dir=${userDataDir}`,
    `--crash-reporter-directory=${crashDir}`,
    `--logsPath=${logsDir}`,
    "--disable-telemetry",
    "--disable-experiments",
    "--skip-welcome",
    "--skip-release-notes",
    "--no-cached-data",
    "--disable-updates",
    "--use-inmemory-secretstorage",
    "--disable-workspace-trust",
  ];

  console.log("KnoxCoder remaining smoke");
  console.log("  electron", electronPath);
  console.log("  workspace", workspace);
  console.log("  KNOX_GLOBAL_DIR", knoxGlobalDir);

  const child = spawn(electronPath, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      KNOX_GLOBAL_DIR: knoxGlobalDir,
      NODE_ENV: "development",
      VSCODE_DEV: "1",
      VSCODE_CLI: "1",
      ELECTRON_ENABLE_LOGGING: "1",
      ELECTRON_ENABLE_STACK_DUMPING: "1",
    },
    stdio: "inherit",
  });

  const code: number = await new Promise((resolve) => {
    child.on("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  process.exit(code);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
