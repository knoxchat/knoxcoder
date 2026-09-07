import { HTMLInputTypeAttribute } from "react";

import { ModelProviderTags } from "../../../components/modelSelection/utils";
import i18n from "../../../i18n";

import { completionParamsInputs } from "./completionParamsInputs";
import { models } from "./models";

import type { ModelPackage } from "./models";

export interface InputDescriptor {
  inputType: HTMLInputTypeAttribute;
  key: string;
  label: string;
  placeholder?: string;
  defaultValue?: string | number;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  required?: boolean;
  description?: string;
  [key: string]: any;
}

export interface ProviderInfo {
  title: string;
  icon?: string;
  provider: string;
  description: string;
  longDescription?: string;
  tags?: ModelProviderTags[];
  packages: ModelPackage[];
  params?: any;
  collectInputFor?: InputDescriptor[];
  refPage?: string;
  apiKeyUrl?: string;
  downloadUrl?: string;
}

const completionParamsInputsConfigs = Object.values(completionParamsInputs);

export const apiBaseInput: InputDescriptor = {
  inputType: "text",
  key: "apiBase",
  label: i18n.t('apiBase'),
  placeholder: "http://knox.chat/v1",
  required: false,
};

export const providers: Partial<Record<string, ProviderInfo>> = {
  knoxchat: {
    title: "KnoxChat",
    provider: "knoxchat",
    description: i18n.t('accessModelsDescription'),
    longDescription:
      i18n.t('knoxchatLongDescription'),
    icon: "knoxchat.png",
    tags: [ModelProviderTags.RequiresApiKey],
    packages: [
      {
        title: i18n.t('loadingModels'),
        description: i18n.t('modelsLoaded'),
        params: {
          title: "KnoxChat",
          model: "openai/gpt-4o-mini",
          contextLength: 128000,
        },
        isOpenSource: false,
      },
    ],
    collectInputFor: [
      {
        inputType: "text",
        key: "apiKey",
        label: i18n.t('apiKeyLabel'),
        placeholder: i18n.t('enterApiKey', { provider: 'KnoxChat' }),
        required: true,
      },
      ...completionParamsInputsConfigs,
      {
        ...apiBaseInput,
        defaultValue: "https://api.knox.chat/v1/",
      },
    ],
    apiKeyUrl: "https://knox.chat/keys",
  },
  openai: {
    title: "OpenAI",
    provider: "openai",
    description: i18n.t('openaiDescription'),
    longDescription:
      i18n.t('openaiLongDescription'),
    icon: "openai.png",
    tags: [ModelProviderTags.RequiresApiKey],
    packages: [
      models.gpt4o,
      models.gpt4omini,
      models.gpt4turbo,
      models.gpt35turbo,
      {
        ...models.AUTODETECT,
        params: {
          ...models.AUTODETECT.params,
          title: "OpenAI",
        },
      },
    ],
    collectInputFor: [
      {
        inputType: "text",
        key: "apiKey",
        label: i18n.t('apiKeyLabel'),
        placeholder: i18n.t('enterApiKey', { provider: 'OpenAI' }),
        required: true,
      },
      ...completionParamsInputsConfigs,
    ],
    apiKeyUrl: "https://platform.openai.com/account/api-keys",
  },
  anthropic: {
    title: "Anthropic",
    provider: "anthropic",
    refPage: "anthropicllm",
    description:
      i18n.t('anthropicDescription'),
    icon: "anthropic.png",
    tags: [ModelProviderTags.RequiresApiKey],
    longDescription:
      i18n.t('anthropicLongDescription'),
    collectInputFor: [
      {
        inputType: "text",
        key: "apiKey",
        label: i18n.t('apiKeyLabel'),
        placeholder: i18n.t('enterApiKey', { provider: 'Anthropic' }),
        required: true,
      },
      ...completionParamsInputsConfigs,
      {
        ...completionParamsInputs.contextLength,
        defaultValue: 100000,
      },
    ],
    packages: [
      models.claude35Sonnet,
      models.claude3Opus,
      models.claude3Sonnet,
      models.claude35Haiku,
    ],
    apiKeyUrl: "https://console.anthropic.com/account/keys",
  },

};
