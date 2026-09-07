import React, { useContext, useLayoutEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { useTranslation } from "react-i18next";

import { Input, SecondaryButton } from "..";
import { lightGray } from "..";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { setDialogMessage, setShowDialog } from "../../redux/slices/uiSlice";
import { InformationCircleIcon } from "../../svg-icons";
import { ToolTip } from "../gui/Tooltip";

interface AddPromptDialogProps {
  existingPrompt?: {
    name: string;
    description: string;
    prompt: string;
  };
}

function AddPromptDialog({ existingPrompt }: AddPromptDialogProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();

  const nameRef = useRef<HTMLInputElement>(null);
  const ideMessenger = useContext(IdeMessengerContext);

  // Initialize state with existing prompt data if editing, or empty strings if adding new
  const [name, setName] = useState(existingPrompt?.name || "");
  const [description, setDescription] = useState(existingPrompt?.description || "");
  const [promptContent, setPromptContent] = useState(existingPrompt?.prompt || "");
  const [error, setError] = useState("");

  const isFormValid = name && description && promptContent;
  const isEditing = !!existingPrompt;

  useLayoutEffect(() => {
    setTimeout(() => {
      if (nameRef.current) {
        nameRef.current.focus();
      }
    }, 100);
  }, [nameRef]);

  const closeDialog = () => {
    dispatch(setShowDialog(false));
    dispatch(setDialogMessage(undefined));
  };

  function onSubmit(e: any) {
    e.preventDefault();

    // Check if the name starts with a slash if it doesn't already have one
    const formattedName = name.startsWith("/") ? name : `/${name}`;
    
    // Ensure prompt content has proper indentation for YAML pipe syntax
    // The pipe character '|' is added by the backend, we just need to ensure proper formatting
    // Remove any leading empty lines and normalize indentation
    const formattedPromptContent = promptContent.trim();

    const promptConfig = {
      name: formattedName,
      description,
      prompt: formattedPromptContent,
    };

    ideMessenger.post("config/addPrompt", promptConfig);

    // Clear form and close dialog
    setName("");
    setDescription("");
    setPromptContent("");
    closeDialog();
  }

  return (
    <div className="px-2 pt-4 sm:px-4">
      <div className="">
        <h3 className="mb-0 hidden sm:block">{isEditing ? t('editPrompt') : t('addPrompt')}</h3>
        <h4 className="sm:hidden">{isEditing ? t('editPrompt') : t('addPrompt')}</h4>
        
        <p className="m-0 mt-2 p-0 text-gray-500">
          {t('promptsCanBeUsed')}
        </p>
        
        <div className="mt-3">
          <form onSubmit={onSubmit} className="flex flex-col gap-1">
            <div className="flex flex-col gap-4">
              {/* Name Field */}
              <label className="flex w-full flex-col gap-1">
                <div className="flex flex-row items-center gap-1">
                  <span>{t('commandName')}</span>
                  <div>
                    <span
                      data-tooltip-id="add-prompt-form-name"
                      className="text-lightgray h-3.5 w-3.5 select-none"
                    >
                      <InformationCircleIcon />
                    </span>
                    <ToolTip id="add-prompt-form-name" place="top">
                      {t('commandNameTooltip')}
                    </ToolTip>
                  </div>
                </div>

                <Input
                  type="text"
                  placeholder="/command-name"
                  value={name}
                  ref={nameRef}
                  onChange={(e) => {
                    const value = e.target.value;
                    setName(value);
                    // Clear any previous errors
                    setError("");
                  }}
                />
              </label>

              {/* Description Field */}
              <label className="flex w-full flex-col gap-1">
                <div className="flex flex-row items-center gap-1">
                  <span>{t('description')}</span>
                  <div>
                    <span
                      data-tooltip-id="add-prompt-form-description"
                      className="text-lightgray h-3.5 w-3.5 select-none"
                    >
                      <InformationCircleIcon />
                    </span>
                    <ToolTip id="add-prompt-form-description" place="top">
                      {t('descriptionTooltip')}
                    </ToolTip>
                  </div>
                </div>
                <Input
                  type="text"
                  placeholder={t('description')}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>

              {/* Prompt Content Field */}
              <label className="flex w-full flex-col gap-1">
                <div className="flex flex-row items-center gap-1">
                  <span>{t('promptContent')}</span>
                  <div>
                    <span
                      data-tooltip-id="add-prompt-form-content"
                      className="text-lightgray h-3.5 w-3.5 select-none"
                    >
                      <InformationCircleIcon />
                    </span>
                    <ToolTip id="add-prompt-form-content" place="top">
                      {t('promptContentTooltip')}
                    </ToolTip>
                  </div>
                </div>

                <div 
                  className="w-full rounded overflow-hidden focus-within:border-knoxcyan"
                  style={{ border: `1px solid var(--vscode-input-border, ${lightGray})` }}
                >
                  <textarea
                    className="w-full h-60 p-3 border-none outline-none resize-y font-mono text-[13px] leading-[1.4]"
                    style={{
                      backgroundColor: 'var(--vscode-input-background, rgb(45, 45, 45))',
                      color: 'var(--vscode-editor-foreground, #d4d4d4)'
                    }}
                    value={promptContent}
                    onChange={(e) => setPromptContent(e.target.value)}
                    placeholder={t('promptPlaceholder')}
                  />
                </div>
              </label>
            </div>

            {error && <p className="mt-2 text-red-500">{error}</p>}

            <div className="mt-4 flex flex-row justify-end gap-2">
              <SecondaryButton
                className="min-w-16"
                type="button"
                onClick={closeDialog}
              >
                {t('cancel')}
              </SecondaryButton>
              <SecondaryButton
                className="min-w-16"
                disabled={!isFormValid}
                type="submit"
              >
                {isEditing ? t('update') : t('add')}
              </SecondaryButton>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default AddPromptDialog; 