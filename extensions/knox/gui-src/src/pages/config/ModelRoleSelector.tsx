import { type ModelDescription } from "core";
import { useTranslation } from "react-i18next";

import { defaultBorderRadius } from "../../components";
import { ToolTip } from "../../components/gui/Tooltip";
import InfoHover from "../../components/InfoHover";
import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
  Transition,
} from "../../components/ui";
import { CheckIcon, ChevronUpDownIcon } from "../../svg-icons";
import { fontSize } from "../../util";

interface ModelRoleSelectorProps {
  models: ModelDescription[];
  selectedModel: ModelDescription | null;
  onSelect: (model: ModelDescription | null) => void;
  displayName: string;
  description: string;
  hideDisplayName?: boolean;
}

const ModelRoleSelector = ({
  models,
  selectedModel,
  onSelect,
  displayName,
  description,
  hideDisplayName = false,
}: ModelRoleSelectorProps) => {
  const { t } = useTranslation();

  function handleSelect(title: string | null) {
    onSelect(models.find((m) => m.title === title) ?? null);
  }

  return (
    <>
      {!hideDisplayName && (
        <div className="mt-2 flex flex-row items-center gap-1 sm:mt-0">
          <span
            style={{
              fontSize: fontSize(-3),
            }}
          >
            {displayName}
          </span>
          <InfoHover size="3" id={displayName} msg={description} />
          <ToolTip id={`${displayName}-description`} place={"bottom"}>
            {description}
          </ToolTip>
        </div>
      )}
      <Listbox value={selectedModel?.title ?? null} onChange={handleSelect}>
        <div className="relative">
          <ListboxButton
            disabled={models.length === 0}
            className={`bg-vsc-editor-background hover:bg-list-active hover:text-list-active-foreground w-full justify-between`}
          >
            {models.length === 0 ? (
              <span className="text-lightgray line-clamp-1 italic">{`${t('noModelsForRole', { role: displayName })}${[t('chatRole'), t('applyRole'), t('editRole')].includes(displayName) ? `. ${t('usingChatModel')}` : ""}`}</span>
            ) : (
              <span className="line-clamp-1">
                {selectedModel?.title ?? `${t('selectRoleModel', { role: displayName })}`}
              </span>
            )}
            {models.length ? (
              <div className="pointer-events-none flex items-center">
                <span className="h-3 w-3 text-knoxcyan mb-0.5" aria-hidden="true">
                  <ChevronUpDownIcon />
                </span>
              </div>
            ) : null}
          </ListboxButton>

          <Transition>
            <ListboxOptions
              style={{ borderRadius: defaultBorderRadius }}
              className="min-w-40"
            >
              {models.map((option, idx) => (
                <ListboxOption key={idx} value={option.title} className={""}>
                  <span
                    className="line-clamp-1 flex h-4 items-center gap-2"
                    style={{ fontSize: fontSize(-3) }}
                  >
                    {option.title}
                  </span>
                  {option.title === selectedModel?.title && (
                    <span className="h-3 w-3" aria-hidden="true">
                      <CheckIcon />
                    </span>
                  )}
                </ListboxOption>
              ))}
            </ListboxOptions>
          </Transition>
        </div>
      </Listbox>
    </>
  );
};

export default ModelRoleSelector;
