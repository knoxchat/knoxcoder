import { useContext } from "react";
import { useTranslation } from "react-i18next";

import { Button, SecondaryButton } from "../../components";
import { useAuth } from "../../context/Auth";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { selectSelectedProfile } from "../../redux/";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { selectDefaultModel } from "../../redux/slices/configSlice";
import { setDialogMessage, setShowDialog } from "../../redux/slices/uiSlice";
import { isLocalProfile } from "../../util";
import { providers } from "../AddNewModel/configs/providers";

interface StreamErrorProps {
  error: unknown;
}
const StreamErrorDialog = ({ error }: StreamErrorProps) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const selectedModel = useAppSelector(selectDefaultModel);
  const selectedProfile = useAppSelector(selectSelectedProfile);
  const { refreshProfiles } = useAuth();

  const handleRefreshProfiles = () => {
    refreshProfiles();
    dispatch(setShowDialog(false));
    dispatch(setDialogMessage(undefined));
  };

  // Collect model information to display useful error info
  let modelTitle = t('chatModel');
  let providerName = t('theModelProvider');
  let apiKeyUrl: string | undefined = undefined;

  if (selectedModel) {
    modelTitle = selectedModel.title;
    providerName = selectedModel.provider;

    // If there's a matching provider from add model form provider info
    // We can get more info
    const foundProvider = Object.values(providers).find(
      (p) => p?.provider === selectedModel.provider,
    );
    if (foundProvider) {
      providerName = foundProvider.title;
      if (foundProvider.apiKeyUrl) {
        apiKeyUrl = foundProvider.apiKeyUrl;
      }
    }
  }

  let message: undefined | string = undefined;
  let statusCode: undefined | number = undefined;

  // Attempt to get error message and status code from error
  if (
    error &&
    (error instanceof Error || typeof error === "object") &&
    "message" in error &&
    typeof error["message"] === "string"
  ) {
    message = error["message"];
    const parts = message?.split(" ") ?? [];
    if (parts.length > 1) {
      const status = parts[0] === "HTTP" ? parts[1] : parts[0];
      if (status) {
        const code = Number(status);
        if (!Number.isNaN(code)) {
          statusCode = code;
        }
      }
    }
  }

  let errorContent: React.ReactNode = <></>;

  // Display components for specific errors
  if (statusCode === 429) {
    errorContent = (
      <div className="flex flex-col gap-2">
        <span>
          {t('rateLimited', { model: modelTitle, provider: providerName })}
        </span>
      </div>
    );
  }

  if (statusCode === 404) {
    errorContent = (
      <div className="flex flex-col gap-2">
        <span>{t('likelyCauses')}</span>
        <ul className="m-0">
          <li>
            <span>{t('invalidApiBase')}</span>
            <code>apiBase</code>
            {selectedModel && (
              <>
                <span>{`: `}</span>
                <code>{selectedModel.apiBase}</code>
              </>
            )}
          </li>
          <li>
            <span>{t('modelNotFound')}</span>
            {selectedModel && (
              <>
                <span>{` for: `}</span>
                <code>{selectedModel.model}</code>
              </>
            )}
          </li>
        </ul>
      </div>
    );
  }

  if (statusCode === 401) {
    errorContent = (
      <div className="flex flex-col gap-2">
        {selectedProfile &&
          !isLocalProfile(selectedProfile) && (
            <div className="flex flex-col gap-1">
              <span>{t('refreshHubSecrets')}</span>
              <SecondaryButton onClick={handleRefreshProfiles}>
                {t('refreshAssistantSecrets')}
              </SecondaryButton>
            </div>
          )}
        <span>{t('invalidApiKey')}</span>
      </div>
    );
  }

  if (
    message &&
    (message.toLowerCase().includes("overloaded") ||
      message.toLowerCase().includes("malformed"))
  ) {
    errorContent = (
      <div className="flex flex-col gap-2">
        <span>{t('serverOverloaded')}</span>
        {selectedModel ? (
          <span>
            {t('provider')}
            <code>{selectedModel.provider}</code>
          </span>
        ) : null}
        {/* TODO: status page links for providers? */}
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-1 px-3 pb-2 pt-2`}>
      <p className="m-0 p-0 text-lg text-red">{`${statusCode ? statusCode + " " : ""}${t('error')}`}</p>

      {message ? (
        <div className="mt-2 flex flex-col gap-0 rounded-xs border border-solid">
          <code className="max-h-20 overflow-y-auto px-1 py-1">{message}</code>
        </div>
      ) : null}
      {/* <div className="mt-3">{errorContent}</div> */}

      <div className="mt-2 flex flex-col gap-1.5">
        <div className="flex flex-row justify-end">
          <Button
            onClick={() => {
              dispatch(setDialogMessage(undefined));
              dispatch(setShowDialog(false));
            }}
          >
            {t('close')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default StreamErrorDialog;