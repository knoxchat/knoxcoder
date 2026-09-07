import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import dotenv from "dotenv";
import { ConfigYaml, DevEventName } from "knoxdev-package/config-yaml";
import * as YAML from "yaml";

import { IdeType } from "../";
import { t } from "../i18n/index.js";
import { defaultConfig } from "../config/default";

dotenv.config();

export function getChromiumPath(): string {
  return path.join(getKnoxUtilsPath(), ".chromium-browser-snapshots");
}

export function getKnoxUtilsPath(): string {
  const utilsPath = path.join(getKnoxGlobalPath(), ".utils");
  if (!fs.existsSync(utilsPath)) {
    fs.mkdirSync(utilsPath);
  }
  return utilsPath;
}

export function getGlobalKnoxIgnorePath(): string {
  const knoxIgnorePath = path.join(
    getKnoxGlobalPath(),
    ".knoxignore",
  );
  if (!fs.existsSync(knoxIgnorePath)) {
    fs.writeFileSync(knoxIgnorePath, "");
  }
  return knoxIgnorePath;
}

export function getKnoxGlobalPath(): string {
  // ~/.knox, or KNOX_GLOBAL_DIR (tests / custom installs). Read env each
  // call so vitest can point at a tmp dir after import.
  const knoxPath =
    process.env.KNOX_GLOBAL_DIR ?? path.join(os.homedir(), ".knox");
  if (!fs.existsSync(knoxPath)) {
    fs.mkdirSync(knoxPath, { recursive: true });
  }
  return knoxPath;
}

export function getSessionsFolderPath(): string {
  const sessionsPath = path.join(getKnoxGlobalPath(), "sessions");
  if (!fs.existsSync(sessionsPath)) {
    fs.mkdirSync(sessionsPath);
  }
  return sessionsPath;
}



export function getSharedConfigFilePath(): string {
  return path.join(getKnoxGlobalPath(), "sharedConfig.json");
}

export function getSessionFilePath(sessionId: string): string {
  return path.join(getSessionsFolderPath(), `${sessionId}.json`);
}

export function getSessionsListPath(): string {
  const filepath = path.join(getSessionsFolderPath(), "sessions.json");
  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, JSON.stringify([]));
  }
  return filepath;
}

export function getConfigYamlPath(_ideType?: IdeType): string {
  const p = path.join(getKnoxGlobalPath(), "config.yaml");
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, YAML.stringify(defaultConfig));
  }
  return p;
}

export function getPrimaryConfigFilePath(): string {
  return getConfigYamlPath();
}

export function getDevDataPath(): string {
  const sPath = path.join(getKnoxGlobalPath(), "dev_data");
  if (!fs.existsSync(sPath)) {
    fs.mkdirSync(sPath);
  }
  return sPath;
}

export function getDevDataSqlitePath(): string {
  return path.join(getDevDataPath(), "devdata.sqlite");
}

export function getMemoryBrainPath(): string {
  const memPath = path.join(getKnoxGlobalPath(), "memory");
  if (!fs.existsSync(memPath)) {
    fs.mkdirSync(memPath, { recursive: true });
  }
  return memPath;
}

export function getMemoryBrainSqlitePath(): string {
  return path.join(getMemoryBrainPath(), "brain.sqlite");
}

export function getDevDataFilePath(
  eventName: DevEventName,
): string {
  const devDataPath = getDevDataPath();
  if (!fs.existsSync(devDataPath)) {
    fs.mkdirSync(devDataPath, { recursive: true });
  }
  return path.join(devDataPath, `${String(eventName)}.jsonl`);
}

export function editConfigFile(
  configYamlCallback: (config: ConfigYaml) => ConfigYaml,
): void {
  const configPath = getConfigYamlPath();
  const config = fs.readFileSync(configPath, "utf8");
  let configYaml = YAML.parse(config);
  if (typeof configYaml === "object" && configYaml !== null) {
    configYaml = configYamlCallback(configYaml as ConfigYaml) as ConfigYaml;
    fs.writeFileSync(configPath, YAML.stringify(configYaml));
  } else {
    console.warn(t("configYamlNotValidObject"));
  }
}

function getMigrationsFolderPath(): string {
  const migrationsPath = path.join(getKnoxGlobalPath(), ".migrations");
  if (!fs.existsSync(migrationsPath)) {
    fs.mkdirSync(migrationsPath);
  }
  return migrationsPath;
}

export async function migrate(
  id: string,
  callback: () => void | Promise<void>,
  onAlreadyComplete?: () => void,
) {
  if (process.env.NODE_ENV === "test") {
    return await Promise.resolve(callback());
  }

  const migrationsPath = getMigrationsFolderPath();
  const migrationPath = path.join(migrationsPath, id);

  if (!fs.existsSync(migrationPath)) {
    try {
      console.log(`Running migration: ${id}`);

      fs.writeFileSync(migrationPath, "");
      await Promise.resolve(callback());
    } catch (e) {
      console.warn(`Migration ${id} failed`, e);
    }
  } else if (onAlreadyComplete) {
    onAlreadyComplete();
  }
}

export function getKnoxDotEnv(): { [key: string]: string } {
  const filepath = path.join(getKnoxGlobalPath(), ".env");
  if (fs.existsSync(filepath)) {
    return dotenv.parse(fs.readFileSync(filepath));
  }
  return {};
}

export function getLogsDirPath(): string {
  const logsPath = path.join(getKnoxGlobalPath(), "logs");
  if (!fs.existsSync(logsPath)) {
    fs.mkdirSync(logsPath);
  }
  return logsPath;
}

export function getCoreLogsPath(): string {
  return path.join(getLogsDirPath(), "core.log");
}

export function getPromptLogsPath(): string {
  return path.join(getLogsDirPath(), "prompt.log");
}

export function getGlobalPromptsPath(): string {
  const promptsPath = path.join(getKnoxGlobalPath(), "prompts");
  if (!fs.existsSync(promptsPath)) {
    fs.mkdirSync(promptsPath, { recursive: true });
  }
  return promptsPath;
}

export function getGlobalAssistantsPath(): string {
  const assistantsPath = path.join(getKnoxGlobalPath(), "assistants");
  if (!fs.existsSync(assistantsPath)) {
    fs.mkdirSync(assistantsPath, { recursive: true });
  }
  return assistantsPath;
}

export function getGlobalRulesPath(): string {
  const rulesPath = path.join(getKnoxGlobalPath(), "rules");
  if (!fs.existsSync(rulesPath)) {
    fs.mkdirSync(rulesPath, { recursive: true });
  }
  return rulesPath;
}

export function getGlobalCheckpointsPath(): string {
  const checkpointsPath = path.join(getKnoxGlobalPath(), "checkpoints");
  if (!fs.existsSync(checkpointsPath)) {
    fs.mkdirSync(checkpointsPath, { recursive: true });
  }
  return checkpointsPath;
}

export function getCheckpointConfigPath(): string {
  return path.join(getKnoxGlobalPath(), "checkpoint-config.json");
}

export function getGlobalSkillsPath(): string {
  const skillsPath = path.join(getKnoxGlobalPath(), "skills");
  if (!fs.existsSync(skillsPath)) {
    fs.mkdirSync(skillsPath, { recursive: true });
  }
  return skillsPath;
}

/** Legacy project-local .knox subdirectory names mapped to global paths */
const PROJECT_KNOX_SUBDIRS: Record<string, (globalRoot: string) => string> = {
  skills: (g) => path.join(g, "skills"),
  prompts: (g) => path.join(g, "prompts"),
  assistants: (g) => path.join(g, "assistants"),
  rules: (g) => path.join(g, "rules"),
  checkpoints: (g) => path.join(g, "checkpoints"),
  brain: (g) => path.join(g, "memory"),
  memory: (g) => path.join(g, "memory"),
  sessions: (g) => path.join(g, "sessions"),
  logs: (g) => path.join(g, "logs"),
  dev_data: (g) => path.join(g, "dev_data"),
};

/** Root-level config files that may exist inside a legacy project .knox/ directory */
const PROJECT_KNOX_ROOT_FILES = [
  "config.yaml",
  "sharedConfig.json",
  "checkpoint-config.json",
  ".env",
  ".knoxignore",
];

function copyDirMerge(src: string, dest: string): void {
  if (!fs.existsSync(src)) {
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirMerge(srcPath, destPath);
    } else if (!fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * One-time migration: move project-root `.knox/` data into `~/.knox/`.
 * Merges files without overwriting existing global data.
 */
export function migrateProjectKnoxToGlobal(workspaceDirs: string[]): void {
  const globalRoot = getKnoxGlobalPath();

  for (const workspaceDir of workspaceDirs) {
    const projectKnoxDir = path.join(workspaceDir, ".knox");
    if (!fs.existsSync(projectKnoxDir)) {
      continue;
    }

    for (const entry of fs.readdirSync(projectKnoxDir, { withFileTypes: true })) {
      const srcPath = path.join(projectKnoxDir, entry.name);

      if (entry.isFile() && PROJECT_KNOX_ROOT_FILES.includes(entry.name)) {
        const destPath = path.join(globalRoot, entry.name);
        if (!fs.existsSync(destPath)) {
          fs.copyFileSync(srcPath, destPath);
        }
        continue;
      }

      const destResolver = PROJECT_KNOX_SUBDIRS[entry.name];
      if (!destResolver) {
        continue;
      }
      const destPath = destResolver(globalRoot);
      if (entry.isDirectory()) {
        copyDirMerge(srcPath, destPath);
      } else if (!fs.existsSync(destPath)) {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  // Migrate workspace-root .knoxignore when no global copy exists yet
  const globalKnoxignore = path.join(globalRoot, ".knoxignore");
  if (!fs.existsSync(globalKnoxignore)) {
    for (const workspaceDir of workspaceDirs) {
      const wsKnoxignore = path.join(workspaceDir, ".knoxignore");
      if (fs.existsSync(wsKnoxignore)) {
        fs.copyFileSync(wsKnoxignore, globalKnoxignore);
        break;
      }
    }
  }
}

export function readAllGlobalPromptFiles(
  folderPath: string = getGlobalPromptsPath(),
): { path: string; content: string }[] {
  if (!fs.existsSync(folderPath)) {
    return [];
  }
  const files = fs.readdirSync(folderPath);
  const promptFiles: { path: string; content: string }[] = [];
  files.forEach((file) => {
    const filepath = path.join(folderPath, file);
    const stats = fs.statSync(filepath);

    if (stats.isDirectory()) {
      const nestedPromptFiles = readAllGlobalPromptFiles(filepath);
      promptFiles.push(...nestedPromptFiles);
    } else if (file.endsWith(".prompt")) {
      const content = fs.readFileSync(filepath, "utf8");
      promptFiles.push({ path: filepath, content });
    }
  });

  return promptFiles;
}

export function getRepoMapFilePath(): string {
  return path.join(getKnoxUtilsPath(), "repo_map.txt");
}

export function migrateV1DevDataFiles() {
  const devDataPath = getDevDataPath();
  function moveToFlatIfExists(
    oldFileName: string,
    newFileName: DevEventName,
  ) {
    // Migration from root-level legacy files
    const oldFilePath = path.join(devDataPath, `${oldFileName}.jsonl`);
    const newFilePath = path.join(devDataPath, `${String(newFileName)}.jsonl`);
    if (fs.existsSync(oldFilePath) && !fs.existsSync(newFilePath)) {
      fs.copyFileSync(oldFilePath, newFilePath);
      fs.unlinkSync(oldFilePath);
    }
    // Migration from versioned subdirectories (0.1.0, 0.2.0, etc.)
    for (const version of ["0.1.0", "0.2.0"]) {
      const versionedPath = path.join(devDataPath, version, `${String(newFileName)}.jsonl`);
      if (fs.existsSync(versionedPath) && !fs.existsSync(newFilePath)) {
        fs.copyFileSync(versionedPath, newFilePath);
        fs.unlinkSync(versionedPath);
      }
    }
  }
  moveToFlatIfExists("tokens_generated", "tokensGenerated");
  moveToFlatIfExists("chat", "chatFeedback");
  moveToFlatIfExists("quickEdit", "quickEdit");
}

export function getLocalEnvironmentDotFilePath(): string {
  return path.join(getKnoxGlobalPath(), ".local");
}

export function getStagingEnvironmentDotFilePath(): string {
  return path.join(getKnoxGlobalPath(), ".staging");
}

export function getDiffsDirectoryPath(): string {
  const diffsPath = path.join(getKnoxGlobalPath(), ".diffs"); // .replace(/^C:/, "c:"); ??
  if (!fs.existsSync(diffsPath)) {
    fs.mkdirSync(diffsPath, {
      recursive: true,
    });
  }
  return diffsPath;
}
