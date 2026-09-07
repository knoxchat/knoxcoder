import { ArrowLeft } from "lucide-react";
import _ from "lodash";
import { useCallback, useContext, useEffect, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { useDispatch } from "react-redux";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  Input,
  lightGray,
  vscBackground,
} from "../../components";
import StyledMarkdownPreview from "../../components/markdown/StyledMarkdownPreview";
import ModelCard from "../../components/modelSelection/ModelCard";
import { ModelProviderTag } from "../../components/modelSelection/ModelProviderTag";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useNavigationListener } from "../../hooks/useNavigationListener";
import { setDefaultModel } from "../../redux/slices/configSlice";
import { updatedObj } from "../../util";

import { providers } from "./configs/providers";

import type { ProviderInfo } from "./configs/providers";

function ConfigureProvider() {
  const { t } = useTranslation();
  useNavigationListener();
  const formMethods = useForm();
  const { providerName } = useParams();
  const ideMessenger = useContext(IdeMessengerContext);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [modelInfo, setModelInfo] = useState<ProviderInfo | undefined>(
    undefined,
  );

  useEffect(() => {
    if (providerName) {
      setModelInfo(providers[providerName]);
    }
  }, [providerName]);

  const disableModelCards = useCallback(() => {
    return (
      modelInfo?.collectInputFor?.some((d) => {
        if (!d.required) {return false;}
        const val = formMethods.watch(d.key);
        return (
          typeof val === "undefined" || (typeof val === "string" && val === "")
        );
      }) || false
    );
  }, [modelInfo, formMethods]);

  return (
    <FormProvider {...formMethods}>
      <div className="overflow-y-scroll">
        <div
          className="sticky top-0 m-0 flex items-center p-0"
          style={{
            borderBottom: `0.5px solid ${lightGray}`,
            backgroundColor: vscBackground,
            zIndex: 2,
          }}
        >
          <ArrowLeft
            width="1.2em"
            height="1.2em"
            onClick={() => navigate("/addModel")}
            className="ml-4 inline-block cursor-pointer text-knoxcyan"
          />
          <h3 className="m-2 inline-block text-lg font-bold">
            {t('configureProvider')}
          </h3>
        </div>

        <div className="px-2">
          <div style={{ display: "flex", alignItems: "center" }}>
            {window.vscMediaUrl && modelInfo?.icon && (
              <img
                src={`${window.vscMediaUrl}/logos/${modelInfo?.icon}`}
                height="24px"
                style={{ marginRight: "10px" }}
              />
            )}
            <h2>{modelInfo?.title}</h2>
          </div>

          {modelInfo?.tags?.map((tag, i) => (
            <ModelProviderTag key={i} tag={tag} />
          ))}

          <StyledMarkdownPreview
            className="mt-2"
            source={modelInfo?.longDescription || modelInfo?.description}
          />
          <br />

          {(modelInfo?.collectInputFor?.filter((d) => d.required).length || 0) >
            0 && (
            <>
              <h3 className="mb-2">{t('enterRequiredParams')}</h3>

              {modelInfo?.collectInputFor
                ?.filter((d) => d.required)
                .map((d, idx) => (
                  <div key={idx} className="mb-2">
                    <label htmlFor={d.key}>{d.label}</label>
                    <Input
                      type={d.inputType}
                      id={d.key}
                      className="m-2 rounded-md border-2 border-gray-200 p-2"
                      placeholder={d.placeholder ?? d.label}
                      defaultValue={d.defaultValue}
                      min={d.min}
                      max={d.max}
                      step={d.step}
                      {...formMethods.register(d.key, {
                        required: true,
                      })}
                    />
                  </div>
                ))}
            </>
          )}

          {(modelInfo?.collectInputFor?.filter((d) => !d.required).length ||
            0) > 0 && (
            <details>
              <summary className="mb-2 cursor-pointer">
                <b>{t('advancedOptional')}</b>
              </summary>

              {modelInfo?.collectInputFor?.map((d, idx) => {
                if (d.required) {return null;}
                return (
                  <div key={idx}>
                    <label htmlFor={d.key}>{d.label}</label>
                    <Input
                      type={d.inputType}
                      id={d.key}
                      className="m-2 rounded-md border-2 border-gray-200 p-2"
                      placeholder={d.placeholder ?? d.label}
                      defaultValue={d.defaultValue}
                      min={d.min}
                      max={d.max}
                      step={d.step}
                      {...formMethods.register(d.key, {
                        required: false,
                      })}
                    />
                  </div>
                );
              })}
            </details>
          )}

          <h3 className="mb-2">{t('selectModelPreset')}</h3>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-8 p-4 justify-items-center items-center">
          {modelInfo?.packages.map((pkg, idx) => {
            return (
              <ModelCard
                key={idx}
                disabled={disableModelCards()}
                title={pkg.title}
                description={pkg.description}
                tags={pkg.tags}
                refUrl={pkg.refUrl}
                icon={pkg.icon || modelInfo.icon}
                dimensions={pkg.dimensions}
                onClick={(e, dimensionChoices) => {
                  if (disableModelCards()) {return;}
                  let formParams: any = {};
                  for (const d of modelInfo.collectInputFor || []) {
                    const val = formMethods.watch(d.key);
                    if (val === "" || val === undefined || val === null) {
                      continue;
                    }
                    formParams = updatedObj(formParams, {
                      [d.key]: d.inputType === "text" ? val : parseFloat(val),
                    });
                  }

                  const model = {
                    ...pkg.params,
                    ...modelInfo.params,
                    ..._.merge(
                      {},
                      ...(pkg.dimensions?.map((dimension, i) => {
                        if (!dimensionChoices?.[i]) {return {};}
                        return {
                          ...dimension.options[dimensionChoices[i]],
                        };
                      }) || []),
                    ),
                    ...formParams,
                    provider: modelInfo.provider,
                  };
                  ideMessenger.post("config/addModel", { model });
                  dispatch(
                    setDefaultModel({ title: model.title, force: true }),
                  );
                  navigate("/");
                }}
              />
            );
          })}
        </div>
      </div>
    </FormProvider>
  );
}

export default ConfigureProvider;
