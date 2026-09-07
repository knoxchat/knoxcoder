import { ConfigResult } from "knoxdev-package/config-yaml";

import {
  BrowserSerializedKnoxConfig,
  KnoxConfig,
  IContextProvider,
  IDE,
  IdeSettings,
  ILLM,
} from "../index.js";
import { t } from "../i18n/index.js";
import { GlobalContext } from "../util/GlobalContext.js";

import { getAllAssistantFiles } from "./loadLocalAssistants.js";
import LocalProfileLoader from "./profile/LocalProfileLoader.js";
import {
  ProfileDescription,
  ProfileLifecycleManager,
} from "./ProfileLifecycleManager.js";

export type { ProfileDescription };

type ConfigUpdateFunction = (payload: ConfigResult<KnoxConfig>) => void;

// Separately manages saving/reloading each profile

export class ConfigHandler {
  /** Reload local assistant/config profiles from disk. */
  async reloadLocalProfiles(): Promise<void> {
    await this.loadLocalProfilesOnly();
  }

  private readonly globalContext = new GlobalContext();
  private additionalContextProviders: IContextProvider[] = [];
  private profiles: ProfileLifecycleManager[] | null = null; // null until profiles are loaded
  private selectedProfileId: string | null = null;
  private localProfileManager: ProfileLifecycleManager;

  initializedPromise: Promise<void>;

  constructor(
    private readonly ide: IDE,
    private ideSettingsPromise: Promise<IdeSettings>,
    private readonly writeLog: (text: string) => Promise<void>,
  ) {
    this.ide = ide;
    this.ideSettingsPromise = ideSettingsPromise;
    this.writeLog = writeLog;

    // Set local profile as default
    const localProfileLoader = new LocalProfileLoader(
      ide,
      ideSettingsPromise,
      this.writeLog,
    );
    this.localProfileManager = new ProfileLifecycleManager(
      localProfileLoader,
      this.ide,
    );

    // Profiles are loaded asynchronously
    this.initializedPromise = new Promise((resolve, reject) => {
      this.init()
        .then(() => {
          resolve();
        })
        .catch((e) => {
          reject(e);
        });
    });
  }

  private async getLocalAssistantProfiles() {
    const assistantFiles = await getAllAssistantFiles(this.ide);
    const profiles = assistantFiles.map((assistant) => {
      return new LocalProfileLoader(
        this.ide,
        this.ideSettingsPromise,
        this.writeLog,
        assistant,
      );
    });
    return profiles.map(
      (profile) => new ProfileLifecycleManager(profile, this.ide),
    );
  }

  /**
   * Retrieves the titles of additional context providers that are of type "submenu".
   *
   * @returns {string[]} An array of titles of the additional context providers that have a description type of "submenu".
   */
  getAdditionalSubmenuContextProviders(): string[] {
    return this.additionalContextProviders
      .filter((provider) => provider.description.type === "submenu")
      .map((provider) => provider.description.title);
  }

  private async init() {
    try {
      await this.loadLocalProfilesOnly();
    } catch (e) {
      console.error(t("failedToLoadLocalProfiles"), e);
    }

    try {
      const configResult = await this.loadConfig();
      this.notifyConfigListeners(configResult);
    } catch (e) {
      console.error(t("failedToLoadConfig"), e);
    }
  }

  get currentProfile() {
    if (!this.selectedProfileId) {
      return null;
    }
    // IMPORTANT
    // We must fall back to null, not the first or local profiles
    // Because GUI must be the source of truth for selected profile
    return (
      this.profiles?.find(
        (p) => p.profileDescription.id === this.selectedProfileId,
      ) ?? null
    );
  }

  get inactiveProfiles() {
    return (this.profiles ?? []).filter(
      (p) => p.profileDescription.id !== this.selectedProfileId,
    );
  }

  async openConfigProfile(profileId?: string) {
    let openProfileId = profileId || this.selectedProfileId;
    const profile = this.profiles?.find(
      (p) => p.profileDescription.id === openProfileId,
    );
    if (profile?.profileDescription.profileType === "local") {
      const ideInfo = await this.ide.getIdeInfo();
      await this.ide.openFile(profile.profileDescription.uri);
    }
  }

  private async getAllLocalProfiles() {
    const localAssistantProfiles = await this.getLocalAssistantProfiles();
    return [this.localProfileManager, ...localAssistantProfiles];
  }

  private async loadLocalProfilesOnly() {
    const allLocalProfiles = await this.getAllLocalProfiles();
    await this.updateAvailableProfiles(allLocalProfiles);
  }

  private async updateAvailableProfiles(profiles: ProfileLifecycleManager[]) {
    this.profiles = profiles;

    // If the last selected profile is in the list choose that
    // Otherwise, choose the first profile
    const previouslySelectedProfileId =
      await this.getPersistedSelectedProfileId();

    // Check if the previously selected profile exists in the current profiles
    const profileExists = profiles.some(
      (profile) =>
        profile.profileDescription.id === previouslySelectedProfileId,
    );

    const selectedProfileId = profileExists
      ? previouslySelectedProfileId
      : (profiles[0]?.profileDescription.id ?? null);

    // Notify listeners
    const profileDescriptions = profiles.map(
      (profile) => profile.profileDescription,
    );
    this.notifyProfileListeners(profileDescriptions, selectedProfileId);
    await this.setSelectedProfile(selectedProfileId);
  }

  async getPersistedSelectedProfileId(): Promise<string | null> {
    const workspaceId = await this.getWorkspaceId();
    const lastSelectedIds =
      this.globalContext.get("lastSelectedProfileForWorkspace") ?? {};
    return lastSelectedIds[workspaceId] ?? null;
  }

  async setSelectedProfile(profileId: string | null) {
    this.selectedProfileId = profileId;
    const result = await this.loadConfig();
    this.notifyConfigListeners(result);
    const selectedProfiles =
      this.globalContext.get("lastSelectedProfileForWorkspace") ?? {};
    selectedProfiles[await this.getWorkspaceId()] = profileId;
    this.globalContext.update(
      "lastSelectedProfileForWorkspace",
      selectedProfiles,
    );
  }

  // A unique ID for the current workspace, built from folder names
  private async getWorkspaceId(): Promise<string> {
    const dirs = await this.ide.getWorkspaceDirs();
    return dirs.join("&");
  }

  // Automatically refresh config when Knox-related IDE (e.g. VS Code) settings are changed
  updateIdeSettings(ideSettings: IdeSettings) {
    this.ideSettingsPromise = Promise.resolve(ideSettings);
    void this.reloadConfig();
  }

  private profilesListeners: ((
    profiles: ProfileDescription[],
    selectedProfileId: string | null,
  ) => void)[] = [];
  onDidChangeAvailableProfiles(
    listener: (
      profiles: ProfileDescription[],
      selectedProfileId: string | null,
    ) => void,
  ) {
    this.profilesListeners.push(listener);
  }

  private notifyProfileListeners(
    profiles: ProfileDescription[],
    selectedProfileId: string | null,
  ) {
    for (const listener of this.profilesListeners) {
      listener(profiles, selectedProfileId);
    }
  }

  private notifyConfigListeners(result: ConfigResult<KnoxConfig>) {
    // Notify listeners that config changed
    for (const listener of this.updateListeners) {
      listener(result);
    }
  }

  private updateListeners: ConfigUpdateFunction[] = [];

  onConfigUpdate(listener: ConfigUpdateFunction) {
    this.updateListeners.push(listener);
  }

  async reloadConfig() {
    if (!this.currentProfile) {
      return {
        config: undefined,
        errors: [],
        configLoadInterrupted: true,
      };
    }

    const { config, errors, configLoadInterrupted } =
      await this.currentProfile.reloadConfig(this.additionalContextProviders);

    if (config) {
      this.inactiveProfiles.forEach((profile) => profile.clearConfig());
    }

    this.notifyConfigListeners({ config, errors, configLoadInterrupted });
    return { config, errors, configLoadInterrupted };
  }

  async getSerializedConfig(): Promise<
    ConfigResult<BrowserSerializedKnoxConfig>
  > {
    if (!this.currentProfile) {
      return {
        config: undefined,
        errors: [],
        configLoadInterrupted: true,
      };
    }
    return await this.currentProfile.getSerializedConfig(
      this.additionalContextProviders,
    );
  }

  listProfiles(): ProfileDescription[] | null {
    return this.profiles?.map((p) => p.profileDescription) ?? null;
  }

  async loadConfig(): Promise<ConfigResult<KnoxConfig>> {
    if (!this.currentProfile) {
      return {
        config: undefined,
        errors: [],
        configLoadInterrupted: true,
      };
    }
    return await this.currentProfile.loadConfig(
      this.additionalContextProviders,
    );
  }

  async llmFromTitle(title?: string): Promise<ILLM> {
    const { config } = await this.loadConfig();
    const model = config?.models.find((m) => m.title === title);
    if (!model) {
      if (config?.models?.length) {
        return config?.models[0];
      }

      throw new Error(t("modelNotFound"));
    }

    return model;
  }

  registerCustomContextProvider(contextProvider: IContextProvider) {
    this.additionalContextProviders.push(contextProvider);
    void this.reloadConfig();
  }
}