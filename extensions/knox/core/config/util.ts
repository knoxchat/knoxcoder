import {
  KnoxConfig,
  ExperimentalModelRoles,
  ILLM,
  ModelDescription,
} from "../";
import { editConfigFile, getKnoxGlobalPath, getConfigYamlPath } from "../util/paths";

export function addModel(
  model: ModelDescription,
  role?: keyof ExperimentalModelRoles,
) {
  console.log(`Adding model '${model.title}' with role '${role}'`);
  console.log(`Global path: ${getKnoxGlobalPath()}`);

  const configYamlPath = getConfigYamlPath();
  console.log(`Config YAML path: ${configYamlPath}`);

  editConfigFile((config) => {
    if (config.models?.some((m: any) => m?.name === model.title)) {
      model.title = `${model.title} (1)`;
    }

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
      apiKey: model.apiKey,
      apiBase: model.apiBase,
    };

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
      const validRoles: ("chat" | "edit" | "apply" | "summarize" | "viewRead" | "realTimeSearch")[] = [];

      for (const r of model.roles) {
        if (["chat", "edit", "apply", "summarize", "viewRead", "realTimeSearch"].includes(r)) {
          validRoles.push(r as any);
        }
      }

      if (validRoles.length > 0) {
        yamlModel.roles = validRoles;
      }
    } else if (role) {
      let modelRole: "chat" | "edit" | "apply" | "summarize" | "viewRead" | "realTimeSearch" | undefined;

      if (role === "inlineEdit") {
        modelRole = "edit";
      } else if (role === "applyCodeBlock") {
        modelRole = "apply";
      } else if (role === "chat") {
        modelRole = "chat";
      } else if (role === "summarize") {
        modelRole = "summarize";
      } else if (role === "viewRead") {
        modelRole = "viewRead";
      } else if (role === "realTimeSearch") {
        modelRole = "realTimeSearch";
      }

      if (modelRole) {
        yamlModel.roles = [modelRole];
      }
    }

    config.models.push(yamlModel);
    console.log(`Added model to YAML config: ${JSON.stringify(yamlModel, null, 2)}`);
    return config;
  });
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
