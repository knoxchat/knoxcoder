import { ModelRole } from "knoxdev-package/config-yaml";
import { useContext, useEffect, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { useDispatch } from "react-redux";
import { useTranslation } from "react-i18next";
import { createKnoxLogger } from "core/util/knoxLog";
import type { ExperimentalModelRoles } from "core";

import { Button, Input, InputSubtext, StyledActionButton } from "../components";
import AddModelButtonSubtext from "../components/AddModelButtonSubtext";
import KnoxChatModelList from "../components/knoxchat/KnoxChatModelList";
import ModelSelectionListbox from "../components/modelSelection/ModelSelectionListbox";
import { useAuth } from "../context/Auth";
import { IdeMessengerContext } from "../context/IdeMessenger";
import { completionParamsInputs } from "../pages/AddNewModel/configs/completionParamsInputs";
import { DisplayInfo } from "../pages/AddNewModel/configs/models";
import {
  ProviderInfo,
  providers,
} from "../pages/AddNewModel/configs/providers";
import { CategorizedModelPackage, fetchKnoxChatModels } from "../pages/AddNewModel/utils/fetchKnoxChatModels";
import { setDefaultModel } from "../redux/slices/configSlice";
import { ArrowRightStartOnRectangleIcon } from "../svg-icons";

const log = createKnoxLogger("AddModelForm");

interface QuickModelSetupProps {
  onDone: () => void;
  modelRole?: ModelRole; // Optional role to assign to the model
}

function AddModelForm({
  onDone,
  modelRole,
}: QuickModelSetupProps) {
  const { t } = useTranslation();
  const [selectedProvider] = useState<ProviderInfo>(
    providers["knoxchat"]!,
  );

  const [selectedModel, setSelectedModel] = useState(
    selectedProvider.packages[0],
  );
  
  const [knoxChatModels, setKnoxChatModels] = useState<CategorizedModelPackage[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const formMethods = useForm();
  const dispatch = useDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const { selectedProfile } = useAuth();

  const selectedProviderApiKeyUrl = selectedProvider.apiKeyUrl;

  function isDisabled() {
    if (
      selectedProvider.downloadUrl
    ) {
      return false;
    }

    const required = selectedProvider.collectInputFor
      ?.filter((input) => input.required)
      .map((input) => {
        const value = formMethods.watch(input.key);
        return value;
      });

    return !required?.every((value) => value !== undefined && value.length > 0);
  }

  useEffect(() => {
    setSelectedModel(selectedProvider.packages[0]);
    
    // Load KnoxChat models when provider changes to KnoxChat
    if (selectedProvider.provider === "knoxchat") {
      setIsLoadingModels(true);
      fetchKnoxChatModels(ideMessenger)
        .then((models) => {
          setKnoxChatModels(models);
          if (models.length > 0) {
            setSelectedModel(models[0] as any);
          }
        })
        .catch((error) => {
          console.error("Failed to fetch KnoxChat models:", error);
        })
        .finally(() => {
          setIsLoadingModels(false);
        });
    } else {
      // Reset KnoxChat models when provider changes to something else
      setKnoxChatModels([]);
    }
  }, [ideMessenger, selectedProvider]);

  function onSubmit() {
    const apiKey = formMethods.watch("apiKey");
    const hasValidApiKey = apiKey !== undefined && apiKey !== "";
    const reqInputFields: Record<string, any> = {};
    for (let input of selectedProvider.collectInputFor ?? []) {
      reqInputFields[input.key] = formMethods.watch(input.key);
    }

    // Create basic model configuration
    let model: any = {
      ...selectedProvider.params,
      ...selectedModel.params,
      ...reqInputFields,
      provider: selectedProvider.provider,
      title: selectedModel.title,
      ...(hasValidApiKey ? { apiKey } : {}),
    };

    // Add name property for YAML format
    // The YAML serializer explicitly looks for a 'name' property
    model.name = model.title;
    
    // If a role is provided, determine how to assign roles
    if (modelRole) {
      // Check if we're in the bulk-add mode (from ModelSelect.tsx)
      const isBulkAddMode = window.location.hash === "#bulkAddMode";
      
      // Only assign multiple roles when in bulk add mode and the role is chat
      if (isBulkAddMode && modelRole === "chat") {
        // Default to chat, edit, and apply roles for models added via ModelSelect
        model.roles = ["chat", "edit", "apply"];
      } else {
        // For ModelsSection.tsx or other role-specific cases, keep original behavior
        model.roles = [modelRole];
      }
    }

    // Add the model to config with role parameter for ExperimentalModelRoles mapping
    // The second parameter is used to update the experimental.modelRoles mapping
    const roleParam = modelRoleToExperimentalRole(modelRole);
    
    log.debug("Adding model with configuration:", JSON.stringify(model, null, 2));
    log.debug("Using experimental role mapping:", modelRole, "→", roleParam);
    log.debug("Sending to config/addModel:", JSON.stringify({
      model,
      role: roleParam
    }, null, 2));

    // First, add the model to the config
    ideMessenger.post("config/addModel", { 
      model,
      role: roleParam
    });

    // If a specific role was provided, update that role's selected model
    if (modelRole && selectedProfile) {
      log.debug(`Updating selected model for role ${modelRole} to ${model.title}`);

      // Update the selected model for this role
      ideMessenger.post("config/updateSelectedModel", {
        role: modelRole,
        title: model.title,
        profileId: selectedProfile.id
      });
      
      // If this is a chat model, also update the default model in Redux
      if (modelRole === "chat") {
        dispatch(setDefaultModel({ title: model.title, force: true }));
      }
    } else {
      // If no specific role, set as default model (chat)
      dispatch(setDefaultModel({ title: model.title, force: true }));
    }

    onDone();
  }

  function onClickDownloadProvider() {
    selectedProvider.downloadUrl &&
      ideMessenger.post("openUrl", selectedProvider.downloadUrl);
  }

  // Determine model options for the current provider (for non-KnoxChat providers)
  const modelOptions = selectedProvider.packages;
  const isKnoxChat = selectedProvider.provider === "knoxchat";

  return (
    <FormProvider {...formMethods}>
      <form onSubmit={formMethods.handleSubmit(onSubmit)}>
        <div className="mx-auto max-w-md p-4">
          <h4 className="text-knoxcyan mb-4 text-center text-sm font-bold">
            {modelRole ? `${t('add')} ${getRoleDisplayName(modelRole, t)} ${t('model')}` : t('addModel')}
          </h4>
          <div className="my-6 flex flex-col gap-6">
            {selectedProvider.downloadUrl && (
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t('installProvider')}
                </label>

                <StyledActionButton onClick={onClickDownloadProvider}>
                  <p className="text-sm underline">
                    {selectedProvider.downloadUrl}
                  </p>
                  <ArrowRightStartOnRectangleIcon />
                </StyledActionButton>
              </div>
            )}

            {isKnoxChat && (
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t('apiKey')}
                </label>
                <Input
                  id="apiKey"
                  className="w-full"
                  placeholder={t('enterApiKey', { provider: selectedProvider.title })}
                  {...formMethods.register("apiKey")}
                />
                <InputSubtext className="mb-0">
                  <a
                    className="cursor-pointer text-inherit underline hover:text-inherit"
                    onClick={() => {
                      if (selectedProviderApiKeyUrl) {
                        ideMessenger.post(
                          "openUrl",
                          selectedProviderApiKeyUrl,
                        );
                      }
                    }}
                  >
                    {t('clickHere')}
                  </a>{" "}
                  {t('toCreateApiKey', { provider: selectedProvider.title })}
                </InputSubtext>
                {isLoadingModels && (
                  <InputSubtext className="mb-0 mt-2">
                    {t('loadingModels')}
                  </InputSubtext>
                )}
                {!isLoadingModels && knoxChatModels.length > 0 && (
                  <InputSubtext className="mb-0 mt-2 ml-1">
                    <span className="text-green-500">
                      {knoxChatModels.length}
                    </span> {t('modelsLoaded')}
                  </InputSubtext>
                )}
                {!isLoadingModels && knoxChatModels.length === 0 && (
                  <InputSubtext className="mb-0 mt-2 text-red-500">
                    {t('failedToLoadModels')}
                  </InputSubtext>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium">{t('model')}</label>
              {isKnoxChat ? (
                <KnoxChatModelList
                  models={knoxChatModels}
                  selectedModel={selectedModel as CategorizedModelPackage}
                  onSelectModel={(model) => setSelectedModel(model)}
                  isLoading={isLoadingModels}
                />
              ) : (
                <ModelSelectionListbox
                  selectedProvider={selectedModel}
                  setSelectedProvider={(val: DisplayInfo) => {
                    const options =
                      Object.entries(providers).find(
                        ([, provider]) =>
                          provider?.title === selectedProvider.title,
                      )?.[1]?.packages ?? [];
                    const match = options.find(
                      (option) => option.title === val.title,
                    );
                    if (match) {
                      setSelectedModel(match);
                    }
                  }}
                  otherOptions={modelOptions}
                />
              )}
            </div>


            {selectedProvider.apiKeyUrl && !isKnoxChat && (
              <div>
                <>
                  <label className="mb-1 block text-sm font-medium">
                    {t('apiKey')}
                  </label>
                  <Input
                    id="apiKey"
                    className="w-full"
                    placeholder={t('enterApiKey', { provider: selectedProvider.title })}
                    {...formMethods.register("apiKey")}
                  />
                  <InputSubtext className="mb-0">
                    <a
                      className="cursor-pointer text-inherit underline hover:text-inherit"
                      onClick={() => {
                        if (selectedProviderApiKeyUrl) {
                          ideMessenger.post(
                            "openUrl",
                            selectedProviderApiKeyUrl,
                          );
                        }
                      }}
                    >
                      {t('clickHere')}
                    </a>{" "}
                    {t('toCreateApiKey', { provider: selectedProvider.title })}
                  </InputSubtext>
                </>
              </div>
            )}

            {selectedProvider.collectInputFor &&
              selectedProvider.collectInputFor
                .filter(
                  (field) =>
                    !Object.values(completionParamsInputs).some(
                      (input) => input.key === field.key,
                    ) &&
                    field.required &&
                    field.key !== "apiKey",
                )
                .map((field) => (
                  <div key={field.key}>
                    <>
                      <label className="mb-1 block text-sm font-medium">
                        {field.label}
                      </label>
                      <Input
                        id={field.key}
                        className="w-full"
                        defaultValue={field.defaultValue}
                        placeholder={`${field.placeholder}`}
                        {...formMethods.register(field.key)}
                      />
                    </>
                  </div>
                ))}
          </div>

          <div className="mt-4 w-full">
            <Button type="submit" className="w-full" disabled={isDisabled()}>
              {t('connect')}
            </Button>
            <AddModelButtonSubtext />
          </div>
        </div>
      </form>
    </FormProvider>
  );
}

// Helper function to get display name for each role
function getRoleDisplayName(role: ModelRole, t: (key: string) => string): string {
  const roleDisplayNames: Record<ModelRole, string> = {
    chat: t('chatRole'),
    edit: t('editRole'),
    apply: t('applyRole'),
    summarize: t('summarizeRole'),
    viewRead: t('viewReadRole'),
    realTimeSearch: t('realTimeSearchRole')
  };
  return roleDisplayNames[role] || role;
}

// Helper function to get description for each role

// Map ModelRole to ExperimentalModelRoles key
function modelRoleToExperimentalRole(role?: ModelRole): keyof ExperimentalModelRoles | undefined {
  if (!role) {return undefined;}
  
  if (role === 'edit') {return 'inlineEdit';}
  if (role === 'apply') {return 'applyCodeBlock';}
  if (role === 'chat') {return 'chat';}
  if (role === 'summarize') {return 'summarize';}
  if (role === 'viewRead') {return 'viewRead';}
  if (role === 'realTimeSearch') {return 'realTimeSearch';}
  
  return undefined;
}

export default AddModelForm;