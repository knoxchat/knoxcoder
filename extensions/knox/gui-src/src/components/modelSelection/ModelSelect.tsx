import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../context/Auth";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import AddModelForm from "../../forms/AddModelForm";
import { useAppSelector } from "../../redux/hooks";
import {
  selectDefaultModel,
  setDefaultModel,
} from "../../redux/slices/configSlice";
import { setDialogMessage, setShowDialog } from "../../redux/slices/uiSlice";
import { AddIcon, CheckIcon, ChipAIIcon, DeleteIcon, DoubleArrowDownIcon, SettingsIcon } from "../../svg-icons";
import { isMetaEquivalentKeyPressed } from "../../util";
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "../ui";

interface ModelOptionProps {
  option: Option;
  idx: number;
  showMissingApiKeyMsg: boolean;
  isSelected?: boolean;
}

interface Option {
  value: string;
  title: string;
  apiKey?: string;
}

function modelSelectTitle(model: any): string {
  if (model?.title) {return model?.title;}
  if (model?.model !== undefined && model?.model.trim() !== "") {
    if (model?.class_name) {
      return `${model?.class_name} - ${model?.model}`;
    }
    return model?.model;
  }
  return model?.class_name;
}

function ModelOption({
  option,
  idx,
  showMissingApiKeyMsg,
  isSelected,
}: ModelOptionProps) {
  const { t } = useTranslation();
  const ideMessenger = useContext(IdeMessengerContext);

  const [hovered, setHovered] = useState(false);

  function onClickGear(e: any) {
    e.stopPropagation();
    e.preventDefault();

    ideMessenger.post("config/openProfile", { profileId: undefined });
  }

  function onClickDelete(e: any) {
    e.stopPropagation();
    e.preventDefault();

    console.log("Delete clicked for model:", option.title, "with value:", option.value);
    
    // Note: confirm() is blocked in sandboxed webview, so proceeding directly
    console.log("Sending delete request for model title:", option.value);
    
    try {
      ideMessenger.post("config/deleteModel", { title: option.value });
      console.log("Delete request sent successfully");
    } catch (error) {
      console.error("Error sending delete request:", error);
    }
  }

  function handleOptionClick(e: any) {
    if (showMissingApiKeyMsg) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  return (
    <ListboxOption
      key={idx}
      disabled={showMissingApiKeyMsg}
      value={option.value}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={handleOptionClick}
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-1 flex-row items-center justify-between gap-2">
          <div className="flex flex-1 flex-row items-center gap-2">
            <span className="h-3.5 w-3.5 shrink-0 mb-1">
              <ChipAIIcon />
            </span>
            <span className="line-clamp-1 flex-1 text-gray-500">
              {option.title}
              {showMissingApiKeyMsg && (
                <span className="ml-2 text-[10px] italic">
                  ({t('missingApiKey')})
                </span>
              )}
            </span>
          </div>
          <div className="flex shrink-0 flex-row items-center gap-1">
            {isSelected && (
              <span className="h-3.5 w-3.5 shrink-0">
                <CheckIcon />
              </span>
            )}
            {hovered && (
              <>
                <span
                  className="h-3 w-3 shrink-0 text-red-500 hover:text-red-600"
                  onClick={onClickDelete}
                  title={t('deleteModel')}
                >
                  <DeleteIcon />
                </span>
                <span
                  className="h-3 w-3 shrink-0"
                  onClick={onClickGear}
                  title={t('configureModel')}
                >
                  <SettingsIcon />
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </ListboxOption>
  );
}

function ModelSelect() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const defaultModel = useAppSelector(selectDefaultModel);
  const allModels = useAppSelector((state) => state.config.config.models);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [sortedOptions, setSortedOptions] = useState<Option[]>([]);
  const { selectedProfile } = useAuth();

  const selectChatModel = useCallback((title: string) => {
    if (!title || title === "addModel") {return;}
    if (title === defaultModel?.title) {return;}
    dispatch(setDefaultModel({ title }));
    if (selectedProfile) {
      ideMessenger.post("config/updateSelectedModel", {
        profileId: selectedProfile.id,
        role: "chat",
        title,
      });
    }
  }, [defaultModel?.title, dispatch, ideMessenger, selectedProfile]);

  // Sort so that options without an API key are at the end
  useEffect(() => {
    const enabledOptions = options.filter((option) => option.apiKey !== "");
    const disabledOptions = options.filter((option) => option.apiKey === "");

    const sorted = [...enabledOptions, ...disabledOptions];

    setSortedOptions(sorted);
  }, [options]);

  // This displays models that have the "chat" role
  // Note: When adding new models through this interface, they will automatically
  // be assigned the "chat", "edit", and "apply" roles (see AddModelForm.tsx)
  useEffect(() => {
    console.log("ModelSelect: allModels changed, updating options. Models:", allModels.map((m: any) => m.title));
    setOptions(
      allModels
        .filter((m) => !m.roles || m.roles.includes("chat"))
        .map((model) => {
          return {
            value: model.title,
            title: modelSelectTitle(model),
            apiKey: model.apiKey,
          };
        }),
    );
  }, [allModels]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "'" && isMetaEquivalentKeyPressed(event as any)) {
        const direction = event.shiftKey ? -1 : 1;
        if (options.length === 0) {return;}
        const currentIndex = options.findIndex(
          (option) => option.value === defaultModel?.title,
        );
        let nextIndex = (currentIndex + 1 * direction) % options.length;
        if (nextIndex < 0) {nextIndex = options.length - 1;}
        const newModelTitle = options[nextIndex].value;
        selectChatModel(newModelTitle);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [options, defaultModel, selectChatModel]);

  function onClickAddModel(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();

    // Close the dropdown
    if (buttonRef.current) {
      buttonRef.current.click();
    }
    dispatch(setShowDialog(true));
    
    // Set the hash to indicate bulk add mode for multi-role assignment
    window.location.hash = "bulkAddMode";
    
    // Create a custom model role processor to handle the model creation
    const handleDone = () => {
      // Clear the hash when done
      window.location.hash = "";
      dispatch(setShowDialog(false));
    };
    
    // The model will default to chat, edit, and apply roles when added via ModelSelect
    dispatch(
      setDialogMessage(
        <AddModelForm
          // We're passing "chat" as the display role
          // The AddModelForm will detect the bulk mode and add all three roles
          modelRole="chat"
          onDone={handleDone}
        />,
      ),
    );
  }

  return (
    // <span className="line-clamp-1">Hiad sfasdfasdf asdfasdf</span>
    <Listbox
      onChange={async (val: string) => {
        selectChatModel(val);
      }}
    >
      <div className="relative flex">
        <ListboxButton
          data-testid="model-select-button"
          ref={buttonRef}
          className="text-knoxcyan h-[18px] gap-1 border-none"
        >
          <span className="line-clamp-1 hover:brightness-110">
            {modelSelectTitle(defaultModel) || t('selectModel')}
          </span>
          <span
            className="h-4 w-4 shrink-0 mt-0.5 hover:brightness-110"
            aria-hidden="true"
          >
            <DoubleArrowDownIcon />
          </span>
        </ListboxButton>
        <ListboxOptions className={"min-w-[160px]"}>
          <div className={`no-scrollbar max-h-[300px] overflow-y-auto`}>
            {sortedOptions.map((option, idx) => (
              <ModelOption
                option={option}
                idx={idx}
                key={idx}
                showMissingApiKeyMsg={option.apiKey === ""}
                isSelected={option.value === defaultModel?.title}
              />
            ))}
          </div>

          <div className="">
            {selectedProfile?.profileType === "local" && (
              <>
                <ListboxOption
                  key={options.length}
                  onClick={onClickAddModel}
                  value={"addModel" as any}
                >
                  <div className="text-knoxcyan flex items-center py-0.5">
                    <span className="mb-1 mr-2 h-3 w-3">
                      <AddIcon />
                    </span>
                    {t('addModel')}
                  </div>
                </ListboxOption>
              </>
            )}
          </div>
        </ListboxOptions>
      </div>
    </Listbox>
  );
}

export default ModelSelect;
