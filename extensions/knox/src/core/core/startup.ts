import { ConfigHandler } from "../config/ConfigHandler";
import { BrainManager } from "../context/memory/brain/BrainManager";
import { DataLogger } from "../data/log";
import { SkillManager } from "../skills";
import { setSkillManager } from "../tools/implementations/skillSingleton";
import {
  migrate,
  migrateProjectKnoxToGlobal,
  migrateV1DevDataFiles,
} from "../util/paths";
import { localPathOrUriToPath } from "../util/pathToUri";

import type { IdeInfo, IdeSettings } from "..";
import type { Core } from "./Core";
import type { CoreRuntime } from "./runtime";

export function migrateCoreData(core: CoreRuntime): void {
  // Ensure global ~/.knoxcoder directory is created and migrate project-local .knox data into it
  migrateV1DevDataFiles();
  void (async () => {
    try {
      const workspaceDirs = await core.ide.getWorkspaceDirs();
      await migrate("v2-project-knox-to-global", () => {
        migrateProjectKnoxToGlobal(
          workspaceDirs.map((dir) => localPathOrUriToPath(dir)),
        );
      });
    } catch (err) {
      console.warn("[Knox] Failed to migrate project .knox data:", err);
    }
  })();
}

export function startBrainAutoConsolidation(core: CoreRuntime): void {
  // Start the Memory Brain auto-consolidation scheduler. Open the store
  // first so the persisted consolidation interval is loaded before the
  // timer is created. Best-effort: memory must never block Core startup.
  void (async () => {
    try {
      const { BrainStore } = await import(
        "../context/memory/brain/BrainStore.js"
      );
      await BrainStore.get();
      BrainManager.startAutoConsolidation();

      // Forward memory/autonomous events to the webview
      BrainManager.onEvent((event) => {
        core.messenger.send("brain/memoryEvent", {
          type: event.type,
          timestamp: event.timestamp,
          data: event.data,
        });
      });
    } catch (err) {
      console.warn("[MemoryBrain] Failed to start auto-consolidation:", err);
    }
  })();
}

export function wireConfigUpdates(core: CoreRuntime): void {
  core.configHandler.onConfigUpdate(async (result) => {
    const serializedResult = await core.configHandler.getSerializedConfig();
    core.messenger.send("configUpdate", {
      result: serializedResult,
      profileId:
        core.configHandler.currentProfile?.profileDescription.id ?? null,
    });

    // update additional submenu context providers registered via VSCode API
    const additionalProviders =
      core.configHandler.getAdditionalSubmenuContextProviders();
    if (additionalProviders.length > 0) {
      core.messenger.send("refreshSubmenuItems", {
        providers: additionalProviders,
      });
    }

    // Give the Memory Brain an LLM so its enhanced features (entity
    // extraction, session summarization, importance scoring) run outside
    // of memory-tool calls too.
    try {
      const chatLlm = result.config?.selectedModelByRole?.chat;
      if (chatLlm) {
        BrainManager.setLlm(chatLlm);
      }
    } catch {
      // LLM wiring is best-effort — heuristic fallbacks cover its absence
    }

    // Reload skills when config changes (paths/urls/disableExternalSkills may have changed)
    try {
      const { config } = result;
      const skillsConfig = config?.skills;
      const workspaceDirs = await core.ide.getWorkspaceDirs();
      const skillManager = new SkillManager({
        workspaceDirs,
        additionalPaths: skillsConfig?.paths,
        urls: skillsConfig?.urls,
        pins: skillsConfig?.pins,
        disableExternalSkills: skillsConfig?.disableExternalSkills,
      });
      setSkillManager(skillManager);
      await skillManager.load();
      console.log(
        `[Skills] Reloaded ${skillManager.all().length} skill(s) after config change`,
      );
    } catch (err) {
      console.error(
        "[Skills] Failed to reload skills on config change:",
        err,
      );
    }
  });

  core.configHandler.onDidChangeAvailableProfiles(
    (profiles, selectedProfileId) =>
      core.messenger.send("didChangeAvailableProfiles", {
        profiles,
        selectedProfileId,
      }),
  );
}

export function wireDataLogger(
  core: Core,
  ideInfoPromise: Promise<IdeInfo>,
  ideSettingsPromise: Promise<IdeSettings>,
): void {
  const dataLogger = DataLogger.getInstance();
  dataLogger.core = core;
  dataLogger.ideInfoPromise = ideInfoPromise;
  dataLogger.ideSettingsPromise = ideSettingsPromise;
}

export function startSkillSystem(core: CoreRuntime): void {
  // ── Skills System ──────────────────────────────────────────────────
  // Initialize the skill manager asynchronously. It will be available
  // for the skill tool by the time any LLM tool call arrives.
  // Reads skills config (paths, urls, disableExternalSkills) from user config.
  const configHandlerRef = core.configHandler;
  void (async () => {
    try {
      const workspaceDirs = await core.ide.getWorkspaceDirs();
      const { config } = await configHandlerRef.loadConfig();
      const skillsConfig = config?.skills;

      const skillManager = new SkillManager({
        workspaceDirs,
        additionalPaths: skillsConfig?.paths,
        urls: skillsConfig?.urls,
        pins: skillsConfig?.pins,
        disableExternalSkills: skillsConfig?.disableExternalSkills,
      });
      setSkillManager(skillManager);
      await skillManager.load();

      const loadedSkills = skillManager.all();
      const loadedDirs = skillManager.dirs();
      console.log(
        `[Skills] Loaded ${loadedSkills.length} skill(s) from ${loadedDirs.length} dir(s)`,
      );
      if (loadedSkills.length > 0) {
        console.log(
          `[Skills] Available: ${loadedSkills.map((s) => s.name).join(", ")}`,
        );
      }
    } catch (err) {
      console.error("[Skills] Failed to initialize skill system:", err);
    }
  })();
}

export function createConfigHandler(
  core: Pick<CoreRuntime, "ide" | "onWrite">,
  ideSettingsPromise: Promise<IdeSettings>,
): ConfigHandler {
  return new ConfigHandler(core.ide, ideSettingsPromise, core.onWrite);
}
