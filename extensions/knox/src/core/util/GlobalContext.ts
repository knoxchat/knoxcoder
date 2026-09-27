import fs from "node:fs";

import { ModelRole } from "knoxdev-package/config-yaml";

import { t } from "../i18n/index.js";
import {
  salvageSharedConfig,
  sharedConfigSchema,
  SharedConfigSchema,
} from "../config/sharedConfig";

import * as path from "path";
import { getKnoxGlobalPath } from "./paths";

export type GlobalContextModelSelections = Partial<
  Record<ModelRole, string | null>
>;

export type ReasoningEffortPrefs = {
  lastEffort?: string;
  byModel: Record<string, string>;
};

export type GlobalContextType = {
  lastSelectedProfileForWorkspace: {
    [workspaceIdentifier: string]: string | null;
  };
  lastSelectedOrgIdForWorkspace: {
    [workspaceIdentifier: string]: string | null;
  };
  selectedModelsByProfileId: {
    [profileId: string]: GlobalContextModelSelections;
  };
  /** Last selected reasoning-effort, persisted across editor restarts. */
  reasoningEffortPrefs: ReasoningEffortPrefs;

  hasAlreadyCreatedAPromptFile: boolean;
  showConfigUpdateToast: boolean;
  sharedConfig: SharedConfigSchema;
};

const EMPTY_REASONING_EFFORT_PREFS: ReasoningEffortPrefs = { byModel: {} };

export function normalizeReasoningEffortPrefs(
  value: unknown,
): ReasoningEffortPrefs {
  if (!value || typeof value !== "object") {
    return { ...EMPTY_REASONING_EFFORT_PREFS };
  }
  const raw = value as Record<string, unknown>;
  const lastEffort =
    typeof raw.lastEffort === "string" && raw.lastEffort.length > 0
      ? raw.lastEffort
      : undefined;
  const byModel: Record<string, string> = {};
  if (
    raw.byModel &&
    typeof raw.byModel === "object" &&
    !Array.isArray(raw.byModel)
  ) {
    for (const [key, effort] of Object.entries(
      raw.byModel as Record<string, unknown>,
    )) {
      if (key && typeof effort === "string" && effort.length > 0) {
        byModel[key] = effort;
      }
    }
  }
  return { lastEffort, byModel };
}

/**
 * A way to persist global state
 */
export class GlobalContext {
  update<T extends keyof GlobalContextType>(
    key: T,
    value: GlobalContextType[T],
  ) {
    const filepath = path.join(getKnoxGlobalPath(), "globalContext.json");
    if (!fs.existsSync(filepath)) {
      fs.writeFileSync(
        filepath,
        JSON.stringify(
          {
            [key]: value,
          },
          null,
          2,
        ),
      );
    } else {
      const data = fs.readFileSync(filepath, "utf-8");

      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch (e: any) {
        console.warn(`Error updating global context: ${e}`);
        return;
      }

      parsed[key] = value;
      fs.writeFileSync(filepath, JSON.stringify(parsed, null, 2));
    }
  }

  get<T extends keyof GlobalContextType>(
    key: T,
  ): GlobalContextType[T] | undefined {
    const filepath = path.join(getKnoxGlobalPath(), "globalContext.json");
    if (!fs.existsSync(filepath)) {
      return undefined;
    }

    const data = fs.readFileSync(filepath, "utf-8");
    try {
      const parsed = JSON.parse(data);
      return parsed[key];
    } catch (e: any) {
      console.warn(`Error parsing global context: ${e}`);
      return undefined;
    }
  }

  getSharedConfig(): SharedConfigSchema {
    const sharedConfig = this.get("sharedConfig") ?? {};
    const result = sharedConfigSchema.safeParse(sharedConfig);
    if (result.success) {
      return result.data;
    } else {
      // in case of damaged shared config, repair it
      // Attempt to salvage any values that are security concerns
      console.error(t("failedToLoadSharedConfig"), result.error);
      const salvagedConfig = salvageSharedConfig(sharedConfig);
      this.update("sharedConfig", salvagedConfig);
      return salvagedConfig;
    }
  }

  updateSharedConfig(
    newValues: Partial<SharedConfigSchema>,
  ): SharedConfigSchema {
    const currentSharedConfig = this.getSharedConfig();
    const updatedSharedConfig = {
      ...currentSharedConfig,
      ...newValues,
    };
    this.update("sharedConfig", updatedSharedConfig);
    return updatedSharedConfig;
  }

  getReasoningEffortPrefs(): ReasoningEffortPrefs {
    return normalizeReasoningEffortPrefs(this.get("reasoningEffortPrefs"));
  }

  updateReasoningEffortPrefs(
    partial: Partial<ReasoningEffortPrefs>,
  ): ReasoningEffortPrefs {
    const current = this.getReasoningEffortPrefs();
    const next: ReasoningEffortPrefs = {
      lastEffort: partial.lastEffort ?? current.lastEffort,
      byModel: {
        ...current.byModel,
        ...(partial.byModel ?? {}),
      },
    };
    this.update("reasoningEffortPrefs", next);
    return next;
  }

  updateSelectedModel(
    profileId: string,
    role: ModelRole,
    title: string | null,
  ): GlobalContextModelSelections {
    const currentSelections = this.get("selectedModelsByProfileId") ?? {};
    const forProfile = currentSelections[profileId] ?? {};
    const newSelections = {
      ...forProfile,
      [role]: title,
    };

    this.update("selectedModelsByProfileId", {
      ...currentSelections,
      [profileId]: newSelections,
    });
    return newSelections;
  }
}
