import { ModelDescription } from "core";
import { ModelRole } from "knoxdev-package/config-yaml";
import { useContext } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { GhostButton } from "../../../../components";
import { useAuth } from "../../../../context/Auth";
import { IdeMessengerContext } from "../../../../context/IdeMessenger";
import AddModelForm from "../../../../forms/AddModelForm";
import ModelRoleSelector from "../../../../pages/config/ModelRoleSelector";
import { useAppDispatch, useAppSelector } from "../../../../redux/hooks";
import {
  selectDefaultModel,
  setDefaultModel,
  updateConfig,
} from "../../../../redux/slices/configSlice";
import { setDialogMessage, setShowDialog } from "../../../../redux/slices/uiSlice";
import { SettingsIcon } from "../../../../svg-icons";
import { getFontSize, fontSize } from "../../../../util";

export function ModelsSection() {
  const { t } = useTranslation();
  const { selectedProfile } = useAuth();
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const [hoveredRole, setHoveredRole] = useState<string | null>(null);

  const config = useAppSelector((state) => state.config.config);
  const selectedChatModel = useAppSelector(selectDefaultModel);

  function handleRoleUpdate(role: ModelRole, model: ModelDescription | null) {
    if (!selectedProfile) {
      return;
    }
    // Optimistic update
    if (role === "chat" && model) {
      dispatch(setDefaultModel({ title: model.title }));
    }
    dispatch(
      updateConfig({
        ...config,
        selectedModelByRole: {
          ...config.selectedModelByRole,
          [role]: model,
        },
      }),
    );
    ideMessenger.post("config/updateSelectedModel", {
      profileId: selectedProfile.id,
      role,
      title: model?.title ?? null,
    });
  }

  function handleChatModelSelection(model: ModelDescription | null) {
    handleRoleUpdate("chat", model);
  }

  function handleOpenAddModelDialog(role?: ModelRole) {
    dispatch(setShowDialog(true));
    dispatch(
      setDialogMessage(
        <AddModelForm
          modelRole={role}
          onDone={() => {
            dispatch(setShowDialog(false));
          }}
        />,
      ),
    );
  }

  const labelStyle = {
    fontSize: fontSize(-3),
  };

  return (
    <div>
      <div className={`text-[${getFontSize() - 1}px] grid grid-cols-1 gap-x-2 gap-y-1 pb-2 sm:grid-cols-[auto_1fr]`}>
        <div className="mt-2 flex flex-row items-center gap-1 sm:mt-0">
          <span style={labelStyle}>{t('chatRole')}</span>
        </div>
        <div
          className="flex items-center w-full"
          onMouseEnter={() => setHoveredRole("chat")}
          onMouseLeave={() => setHoveredRole(null)}
        >
          <ModelRoleSelector
            displayName={t('chatRole')}
            description={t('usedForChat')}
            models={config.modelsByRole.chat}
            selectedModel={
              selectedChatModel
                ? {
                    title: selectedChatModel.title,
                    provider: selectedChatModel.provider,
                    model: selectedChatModel.model,
                  }
                : null
            }
            onSelect={(model) => handleChatModelSelection(model)}
            hideDisplayName={true}
          />
          <button 
            className={`w-6 h-6 flex items-center justify-center bg-transparent border-none rounded-md cursor-pointer p-1 ml-2 transition-opacity ${hoveredRole === "chat" ? "opacity-75 visible hover:opacity-100 hover:bg-lightgray/20" : "opacity-0 invisible"}`}
            onClick={() => handleOpenAddModelDialog("chat")}
            title={t('addUpdateRoleModel', { role: t('chatRole') })}
          >
            <SettingsIcon className="h-4 w-4 text-knoxcyan" />
          </button>
        </div>

        <div className="mt-2 flex flex-row items-center gap-1 sm:mt-0">
          <span style={labelStyle}>{t('editRole')}</span>
        </div>
        <div
          className="flex items-center w-full"
          onMouseEnter={() => setHoveredRole("edit")}
          onMouseLeave={() => setHoveredRole(null)}
        >
          <ModelRoleSelector
            displayName={t('editRole')}
            description={t('usedForEdit')}
            models={config.modelsByRole.edit}
            selectedModel={config.selectedModelByRole.edit}
            onSelect={(model) => handleRoleUpdate("edit", model)}
            hideDisplayName={true}
          />
          <button 
            className={`w-6 h-6 flex items-center justify-center bg-transparent border-none rounded-md cursor-pointer p-1 ml-2 transition-opacity ${hoveredRole === "edit" ? "opacity-75 visible hover:opacity-100 hover:bg-lightgray/20" : "opacity-0 invisible"}`}
            onClick={() => handleOpenAddModelDialog("edit")}
            title={t('addUpdateRoleModel', { role: t('editRole') })}
          >
            <SettingsIcon className="h-4 w-4 text-knoxcyan" />
          </button>
        </div>

        <div className="mt-2 flex flex-row items-center gap-1 sm:mt-0">
          <span style={labelStyle}>{t('applyRole')}</span>
        </div>
        <div
          className="flex items-center w-full"
          onMouseEnter={() => setHoveredRole("apply")}
          onMouseLeave={() => setHoveredRole(null)}
        >
          <ModelRoleSelector
            displayName={t('applyRole')}
            description={t('usedForApply')}
            models={config.modelsByRole.apply}
            selectedModel={config.selectedModelByRole.apply}
            onSelect={(model) => handleRoleUpdate("apply", model)}
            hideDisplayName={true}
          />
          <button 
            className={`w-6 h-6 flex items-center justify-center bg-transparent border-none rounded-md cursor-pointer p-1 ml-2 transition-opacity ${hoveredRole === "apply" ? "opacity-75 visible hover:opacity-100 hover:bg-lightgray/20" : "opacity-0 invisible"}`}
            onClick={() => handleOpenAddModelDialog("apply")}
            title={t('addUpdateRoleModel', { role: t('applyRole') })}
          >
            <SettingsIcon className="h-4 w-4 text-knoxcyan" />
          </button>
        </div>

        <div className="mt-2 flex flex-row items-center gap-1 sm:mt-0">
          <span style={labelStyle}>{t('viewReadRole')}</span>
        </div>
        <div
          className="flex items-center w-full"
          onMouseEnter={() => setHoveredRole("viewRead")}
          onMouseLeave={() => setHoveredRole(null)}
        >
          <ModelRoleSelector
            displayName={t('viewReadRole')}
            description={t('usedForViewRead')}
            models={config.modelsByRole.viewRead}
            selectedModel={config.selectedModelByRole.viewRead}
            onSelect={(model) => handleRoleUpdate("viewRead", model)}
            hideDisplayName={true}
          />
          <button 
            className={`w-6 h-6 flex items-center justify-center bg-transparent border-none rounded-md cursor-pointer p-1 ml-2 transition-opacity ${hoveredRole === "viewRead" ? "opacity-75 visible hover:opacity-100 hover:bg-lightgray/20" : "opacity-0 invisible"}`}
            onClick={() => handleOpenAddModelDialog("viewRead")}
            title={t('addUpdateRoleModel', { role: t('viewReadRole') })}
          >
            <SettingsIcon className="h-4 w-4 text-knoxcyan" />
          </button>
        </div>

        <div className="mt-2 flex flex-row items-center gap-1 sm:mt-0">
          <span style={labelStyle}>{t('realTimeSearchRole')}</span>
        </div>
        <div
          className="flex items-center w-full"
          onMouseEnter={() => setHoveredRole("realTimeSearch")}
          onMouseLeave={() => setHoveredRole(null)}
        >
          <ModelRoleSelector
            displayName={t('realTimeSearchRole')}
            description={t('usedForRealTimeSearch')}
            models={config.modelsByRole.realTimeSearch}
            selectedModel={config.selectedModelByRole.realTimeSearch}
            onSelect={(model) => handleRoleUpdate("realTimeSearch", model)}
            hideDisplayName={true}
          />
          <button 
            className={`w-6 h-6 flex items-center justify-center bg-transparent border-none rounded-md cursor-pointer p-1 ml-2 transition-opacity ${hoveredRole === "realTimeSearch" ? "opacity-75 visible hover:opacity-100 hover:bg-lightgray/20" : "opacity-0 invisible"}`}
            onClick={() => handleOpenAddModelDialog("realTimeSearch")}
            title={t('addUpdateRoleModel', { role: t('realTimeSearchRole') })}
          >
            <SettingsIcon className="h-4 w-4 text-knoxcyan" />
          </button>
        </div>

      </div>
      
      {/* Custom config button */}
      <GhostButton
        className="w-full cursor-pointer rounded-sm px-2 text-center text-knoxcyan hover:text-gray-300"
        style={{
          fontSize: fontSize(-3),
        }}
        onClick={(e) => {
          e.preventDefault();
          // Open the config file directly
          if (selectedProfile?.profileType === "local") {
            ideMessenger.request("config/openProfile", {
              profileId: selectedProfile.id,
            });
          }
        }}
      >
        <div className="flex items-center justify-center gap-1 text-knoxcyan">
          <SettingsIcon className="h-3 w-3" /> {t('openConfigFile')}
        </div>
      </GhostButton>
    </div>
  );
}
