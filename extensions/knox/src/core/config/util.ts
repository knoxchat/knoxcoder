import { ALL_MODEL_ROLES, ModelRole } from "knoxdev-package/config-yaml";

import {
  KnoxConfig,
  ExperimentalModelRoles,
  ILLM,
  ModelDescription,
} from "../";
import { editConfigFile, getKnoxGlobalPath, getConfigYamlPath } from "../util/paths";

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  knoxchat: "KnoxStudio",
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

export function providerDisplayName(provider?: string): string {
  const id = provider?.trim();
  if (!id) {
    return "";
  }
  return PROVIDER_DISPLAY_NAMES[id] ?? id;
}

/**
 * YAML `name` must be unique. Prefer a provider prefix over ` (1)` when the
 * same catalog title is added from a second provider.
 */
export function uniqueYamlModelName(
  existingNames: readonly string[],
  title: string,
  provider?: string,
): string {
  const names = new Set(existingNames.filter(Boolean));
  if (!names.has(title)) {
    return title;
  }
  const label = providerDisplayName(provider);
  const withProvider = label ? `${label} · ${title}` : title;
  if (withProvider !== title && !names.has(withProvider)) {
    return withProvider;
  }
  let n = 1;
  while (names.has(`${withProvider} (${n})`)) {
    n += 1;
  }
  return `${withProvider} (${n})`;
}

/** Connect always selects the composer model; every action uses that model. */
export function addModelSelectRole(_role?: string): ModelRole {
  return "chat";
}

export function addModel(
  model: ModelDescription,
  role?: keyof ExperimentalModelRoles,
): string {
  console.log(`Adding model '${model.title}' with role '${role}'`);
  console.log(`Global path: ${getKnoxGlobalPath()}`);

  const configYamlPath = getConfigYamlPath();
  console.log(`Config YAML path: ${configYamlPath}`);

  let yamlTitle = model.title ?? "";
  editConfigFile((config) => {
    const existing = (config.models ?? [])
      .map((m: any) => (typeof m?.name === "string" ? m.name : ""))
      .filter(Boolean);
    model.title = uniqueYamlModelName(existing, model.title ?? yamlTitle, model.provider);
    yamlTitle = model.title ?? yamlTitle;

    if (!config.models) {
      config.models = [];
    }

    const yamlModel: {
      name: string;
      provider: string;
      model: string;
      apiKey?: string;
      apiBase?: string;
      defaultCompletionOptions?: any;
      capabilities?: (
        | "tool_use"
        | "image_input"
        | "image_output"
        | "reasoning"
        | "web_search"
      )[];
      roles?: ("chat" | "edit" | "apply" | "summarize" | "viewRead" | "realTimeSearch")[];
    } = {
      name: model.title,
      provider: model.provider,
      model: model.model,
      apiBase: model.apiBase,
    };
    if (model.apiKey) {
      yamlModel.apiKey = model.apiKey;
    }

    const defaultCompletionOptions = {
      ...model.completionOptions,
      ...(Number.isFinite(model.contextLength)
        ? { contextLength: model.contextLength }
        : {}),
    };

    if (Object.keys(defaultCompletionOptions).length > 0) {
      yamlModel.defaultCompletionOptions = defaultCompletionOptions;
    }

    const yamlCapabilities: (
      | "tool_use"
      | "image_input"
      | "image_output"
      | "reasoning"
      | "web_search"
    )[] = [];
    if (model.capabilities?.tools) {
      yamlCapabilities.push("tool_use");
    }
    if (model.capabilities?.uploadImage) {
      yamlCapabilities.push("image_input");
    }
    if (model.capabilities?.imageOutput) {
      yamlCapabilities.push("image_output");
    }
    if (model.capabilities?.reasoning) {
      yamlCapabilities.push("reasoning");
    }
    if (model.capabilities?.webSearch) {
      yamlCapabilities.push("web_search");
    }
    if (yamlCapabilities.length > 0) {
      yamlModel.capabilities = yamlCapabilities;
    }

    if (model.roles && Array.isArray(model.roles)) {
      const validRoles = model.roles.filter((r): r is (typeof ALL_MODEL_ROLES)[number] =>
        (ALL_MODEL_ROLES as readonly string[]).includes(r),
      );

      yamlModel.roles = validRoles.length > 0 ? validRoles : [...ALL_MODEL_ROLES];
    } else {
      yamlModel.roles = [...ALL_MODEL_ROLES];
    }

    config.models.push(yamlModel);
    console.log(`Added model to YAML config: ${JSON.stringify(yamlModel, null, 2)}`);
    return config;
  });
  return yamlTitle;
}

export function deleteModel(title: string) {
  editConfigFile((config) => {
    config.models = config.models?.filter((m: any) => m.name !== title);
    return config;
  });
}

export function getModelByRole<T extends keyof ExperimentalModelRoles>(
  config: KnoxConfig,
  role: T,
): ILLM | undefined {
  const roleTitle = config.experimental?.modelRoles?.[role];

  if (!roleTitle) {
    return undefined;
  }

  const matchingModel = config.models.find(
    (model) => model.title === roleTitle,
  );

  return matchingModel;
}

export function addPrompt(promptData: { name: string; description: string; prompt: string }) {
  console.log(`Adding/updating prompt '${promptData.name}'`);

  const configYamlPath = getConfigYamlPath();
  console.log(`Config YAML path: ${configYamlPath}`);

  editConfigFile((config) => {
    if (!config.prompts) {
      config.prompts = [];
    }

    const existingPromptIndex = config.prompts.findIndex(
      (p: any) => p.name === promptData.name,
    );

    const yamlPrompt = {
      name: promptData.name,
      description: promptData.description,
      prompt: promptData.prompt,
    };

    if (existingPromptIndex !== -1) {
      config.prompts[existingPromptIndex] = yamlPrompt;
      console.log(`Updated existing prompt in YAML config: ${promptData.name}`);
    } else {
      config.prompts.push(yamlPrompt);
      console.log(`Added new prompt to YAML config: ${promptData.name}`);
    }

    return config;
  });
}
