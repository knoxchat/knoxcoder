import { useTranslation } from "react-i18next";

import { defaultBorderRadius } from "..";

import { MODEL_PROVIDER_TAG_COLORS, ModelProviderTags } from "./utils";

const TAG_I18N_KEYS: Record<ModelProviderTags, string> = {
  [ModelProviderTags.RequiresApiKey]: "tagApiKeyRequired",
  [ModelProviderTags.Local]: "tagLocal",
  [ModelProviderTags.Free]: "tagFree",
  [ModelProviderTags.OpenSource]: "tagOpenSource",
};

export interface ModelProviderTagProps {
  tag: ModelProviderTags;
}

export function ModelProviderTag({ tag }: ModelProviderTagProps) {
  const { t } = useTranslation();
  return (
    <span
      style={{
        fontSize: "0.9em",
        backgroundColor: `${MODEL_PROVIDER_TAG_COLORS[tag]}55`,
        color: "white",
        padding: "2px 4px",
        borderRadius: defaultBorderRadius,
        marginRight: "4px",
      }}
    >
      {t(TAG_I18N_KEYS[tag])}
    </span>
  );
}
