import { useContext } from "react";
import { useTranslation } from "react-i18next";

import { GhostButton } from "../../..";
import { useAuth } from "../../../../context/Auth";
import { IdeMessengerContext } from "../../../../context/IdeMessenger";
import { AddIcon, ShareIcon } from "../../../../svg-icons";
import { fontSize } from "../../../../util";

export function ExploreBlocksButton(props: { blockType: string }) {
  const { t } = useTranslation();
  const { selectedProfile } = useAuth();
  const ideMessenger = useContext(IdeMessengerContext);

  const blockTypeTranslations: Record<string, string> = {
    "rules": t('rules'),
    "prompts": t('prompts'),
    "models": t('models'),
    "tools": t('tools'),
    "promptTemplates": t('promptTemplates'),
    "examples": t('examples'),
    "aiFunctions": t('aiFunctions'),
  };

  const isLocal = selectedProfile?.profileType === "local";

  const Icon = isLocal ? AddIcon : ShareIcon;
  const text = `${isLocal ? t('add') : t('explore')} ${
    blockTypeTranslations[props.blockType] || props.blockType
  }`;

  const handleClick = () => {
    if (isLocal) {
      ideMessenger.request("config/openProfile", {
        profileId: selectedProfile.id,
      });
    }
  };

  return (
    <GhostButton
      className="w-full cursor-pointer rounded-sm px-2 text-center text-knoxcyan hover:text-gray-300"
      style={{
        fontSize: fontSize(-3),
      }}
      onClick={(e) => {
        e.preventDefault();
        handleClick();
      }}
    >
      <div className="flex items-center justify-center gap-1 text-knoxcyan">
        <Icon className="h-3 w-3" /> {text}
      </div>
    </GhostButton>
  );
}
