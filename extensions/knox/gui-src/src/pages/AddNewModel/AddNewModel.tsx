import _ from "lodash";
import React, { useContext } from "react";
import { useDispatch } from "react-redux";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  lightGray,
  vscBackground,
} from "../../components";
import ModelCard from "../../components/modelSelection/ModelCard";
import Toggle from "../../components/modelSelection/Toggle";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useNavigationListener } from "../../hooks/useNavigationListener";
import { setDefaultModel } from "../../redux/slices/configSlice";
import { ArrowLeftIcon } from "../../svg-icons";

import { ModelPackage, models } from "./configs/models";
import { providers } from "./configs/providers";

/**
 * Used to display groupings in the Models tab
 */
const modelsByProvider: Record<string, ModelPackage[]> = {
  "Open AI": [models.gpt4turbo, models.gpt4o, models.gpt35turbo],
  Anthropic: [models.claude3Opus, models.claude3Sonnet, models.claude35Haiku],
};

function AddNewModel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  useNavigationListener();
  const ideMessenger = useContext(IdeMessengerContext);

  const [providersSelected, setProvidersSelected] = React.useState(true);

  return (
    <div className="mb-6 overflow-y-scroll">
      <div
        className="sticky top-0 m-0 flex items-center p-0"
        style={{
          borderBottom: `0.5px solid ${lightGray}`,
          backgroundColor: vscBackground,
          zIndex: 2,
        }}
      >
        <span
          onClick={() => navigate("/")}
          className="ml-4 inline-block cursor-pointer"
        >
          <ArrowLeftIcon />
        </span>
        <h3 className="m-2 inline-block text-lg font-bold">{t('addNewModel')}</h3>
      </div>
      <br />
      <div className="px-6">
        <div className="p-2 px-3 rounded-md border border-lightgray mt-4 mb-4">
          {t('addModelInstructions')}
          <ul>
            <li>
              {t('addModelOption1')}
            </li>
            <li>{t('addModelOption2')}</li>
          </ul>
          <Link
            target="_blank"
            to="https://docs.knox.chat/model-setup/overview"
          >
            {t('visitSetupDocs')}
          </Link>{" "}
          {t('toLearnMore')}
        </div>

        <div className="col-span-full py-4">
          <Toggle
            selected={providersSelected}
            optionOne={t('startWithProvider')}
            optionTwo={t('selectSpecificModel')}
            onClick={() => {
              setProvidersSelected((prev) => !prev);
            }}
          ></Toggle>
        </div>

        {providersSelected ? (
          <>
            <div className="col-span-full mb-8 text-center leading-relaxed">
              <h2 className="mb-0">{t('provider')}</h2>
              <p className="mt-2">
                {t('selectProviderBelow')}
              </p>
            </div>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-5 justify-items-center items-center">
              {Object.entries(providers).map(([providerName, modelInfo], i) =>
                modelInfo ? (
                  <ModelCard
                    key={`${providerName}-${i}`}
                    title={modelInfo.title}
                    description={modelInfo.description}
                    tags={modelInfo.tags}
                    icon={modelInfo.icon}
                    refUrl={`https://docs.knox.chat/reference/Model%20Providers/${
                      modelInfo.refPage || modelInfo.provider.toLowerCase()
                    }`}
                    onClick={() => {
                      console.log(`/addModel/provider/${providerName}`);
                      navigate(`/addModel/provider/${providerName}`);
                    }}
                  />
                ) : null,
              )}
            </div>
          </>
        ) : (
          <>
            <div className="col-span-full text-center leading-relaxed">
              <h2 className="mb-0">{t('models')}</h2>
              <p className="mt-2">
                {t('selectModelBelow')}
              </p>
            </div>

            {Object.entries(modelsByProvider).map(
              ([providerTitle, modelConfigsByProviderTitle]) => (
                <div className="mb-6 flex flex-col" key={providerTitle}>
                  <div className="mb-4 w-full items-center">
                    <h3 className="">{providerTitle}</h3>
                    <hr
                      style={{
                        height: "0px",
                        width: "100%",
                        color: lightGray,
                        border: `1px solid ${lightGray}`,
                        borderRadius: "2px",
                      }}
                    />
                  </div>

                  <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-5 justify-items-center items-center">
                    {modelConfigsByProviderTitle.map((config) => (
                      <ModelCard
                        key={config.title}
                        title={config.title}
                        description={config.description}
                        tags={config.tags}
                        icon={config.icon}
                        dimensions={config.dimensions}
                        providerOptions={config.providerOptions}
                        onClick={(e, dimensionChoices, selectedProvider) => {
                          if (!selectedProvider) {
                            return;
                          }
                          const model = {
                            ...config.params,
                            ..._.merge(
                              {},
                              ...(config.dimensions?.map((dimension, i) => {
                                if (!dimensionChoices?.[i]) {return {};}
                                return {
                                  ...dimension.options[dimensionChoices[i]],
                                };
                              }) || []),
                            ),
                            provider: providers[selectedProvider]?.provider,
                          };
                          ideMessenger.post("config/addModel", { model });
                          dispatch(
                            setDefaultModel({
                              title: model.title,
                              force: true,
                            }),
                          );
                          navigate("/");
                        }}
                      />
                    ))}
                  </div>
                </div>
              ),
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default AddNewModel;
