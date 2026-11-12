import { attachSessionPermission } from "../agent/sessionPermission";
import { addModel, addModelSelectRole, deleteModel, addPrompt } from "../config/util";
import { createNewPromptFileV2 } from "../promptFiles/v2/createNewPromptFile";

import type { CoreRuntime } from "./runtime";

export function registerConfigHandlers(core: CoreRuntime): void {
  const on = core.messenger.on.bind(core.messenger);

  // Edit config
  on("config/addModel", async (msg) => {
    const model = msg.data.model;
    const title = addModel(model, msg.data.role);
    const profileId = core.configHandler.currentProfile?.profileDescription.id;
    if (profileId && title) {
      // Select before reload so rectify sees the new yaml name and does not
      // fall back to the previous chat/edit/apply model.
      core.globalContext.updateSelectedModel(
        profileId,
        addModelSelectRole(msg.data.role),
        title,
      );
    }
    await core.configHandler.reloadConfig();
    return title;
  });

  on("config/deleteModel", (msg) => {
    deleteModel(msg.data.title);
    void core.configHandler.reloadConfig();
  });

  on("config/addPrompt", (msg) => {
    addPrompt(msg.data);
    void core.configHandler.reloadConfig();
  });

  on("config/newPromptFile", async (msg) => {
    const { config } = await core.configHandler.loadConfig();
    await createNewPromptFileV2(core.ide, config?.experimental?.promptPath);
    await core.configHandler.reloadConfig();
  });

  on("config/openProfile", async (msg) => {
    await core.configHandler.openConfigProfile(msg.data.profileId);
  });

  on("config/reload", async (msg) => {
    void core.configHandler.reloadConfig();
    const serialized = await core.configHandler.getSerializedConfig();
    await attachSessionPermission(serialized, core.ide);
    return serialized;
  });

  on("config/ideSettingsUpdate", (msg) => {
    core.configHandler.updateIdeSettings(msg.data);
  });

  on("config/listProfiles", async (msg) => {
    const profiles = core.configHandler.listProfiles();
    const selectedProfileId =
      core.configHandler.currentProfile?.profileDescription.id ?? null;
    return { profiles, selectedProfileId };
  });

  on("config/refreshProfiles", async (_msg) => {
    await core.configHandler.reloadLocalProfiles();
  });

  on("config/updateSharedConfig", async (msg) => {
    const newSharedConfig = core.globalContext.updateSharedConfig(msg.data);
    await core.configHandler.reloadConfig();
    return newSharedConfig;
  });

  on("config/updateSelectedModel", async (msg) => {
    const newSelectedModels = core.globalContext.updateSelectedModel(
      msg.data.profileId,
      msg.data.role,
      msg.data.title,
    );
    await core.configHandler.reloadConfig();
    return newSelectedModels;
  });

  on("ui/getReasoningEffortPrefs", async () => {
    return core.globalContext.getReasoningEffortPrefs();
  });

  on("ui/updateReasoningEffortPrefs", async (msg) => {
    return core.globalContext.updateReasoningEffortPrefs(msg.data ?? {});
  });

  on("config/getSerializedProfileInfo", async (msg) => {
    const result = await core.configHandler.getSerializedConfig();
    await attachSessionPermission(result, core.ide);
    return {
      result,
      profileId:
        core.configHandler.currentProfile?.profileDescription.id ?? null,
    };
  });

  on("didChangeSelectedProfile", async (msg) => {
    await core.configHandler.setSelectedProfile(msg.data.id);
    await core.configHandler.reloadConfig();
  });
}
