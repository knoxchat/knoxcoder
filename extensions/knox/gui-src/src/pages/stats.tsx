import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { table } from "table";

import { lightGray, vscBackground } from "../components";
import { CopyIconButton } from "../components/gui/CopyIconButton";
import { IdeMessengerContext } from "../context/IdeMessenger";
import { useNavigationListener } from "../hooks/useNavigationListener";
import { ArrowLeftIcon } from "../svg-icons";

function generateTable(data: unknown[][]) {
  return table(data);
}

function Stats() {
  const { t } = useTranslation();
  useNavigationListener();
  const navigate = useNavigate();
  const ideMessenger = useContext(IdeMessengerContext);

  const [days, setDays] = useState<
    { day: string; promptTokens: number; generatedTokens: number }[]
  >([]);
  const [models, setModels] = useState<
    { model: string; promptTokens: number; generatedTokens: number }[]
  >([]);

  useEffect(() => {
    ideMessenger.request("stats/getTokensPerDay", undefined).then((result) => {
      result.status === "success" && setDays(result.content);
    });
  }, []);

  useEffect(() => {
    ideMessenger
      .request("stats/getTokensPerModel", undefined)
      .then((result) => {
        result.status === "success" && setModels(result.content);
      });
  }, []);

  return (
    <div
      style={{
        backgroundColor: vscBackground,
      }}
    >
      <div
        onClick={() => navigate(-1)}
        className="sticky top-0 m-0 flex cursor-pointer items-center p-0"
        style={{
          borderBottom: `0.5px solid ${lightGray}`,
          backgroundColor: vscBackground,
        }}
      >
        <span className="ml-4 inline-block h-3 w-3 cursor-pointer">
          <ArrowLeftIcon />
        </span>
        <span className="m-2 inline-block text-base font-bold">{t('more')}</span>
      </div>

      <div className="p-2">
        <div className="flex items-center gap-2">
          <h2 className="ml-2">{t('dailyTokens')}</h2>
          <CopyIconButton
            text={generateTable(
              ([[t('day'), t('generatedTokens'), t('promptTokens')]] as any).concat(
                days.map((day) => [
                  day.day,
                  day.generatedTokens,
                  day.promptTokens,
                ]),
              ),
            )}
          />
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="overflow-wrap-anywhere border border-lightgray">
              <th className="p-2 text-left border border-lightgray">{t('day')}</th>
              <th className="p-2 text-left border border-lightgray">{t('generatedTokens')}</th>
              <th className="p-2 text-left border border-lightgray">{t('promptTokens')}</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.day} className="overflow-wrap-anywhere border border-lightgray hover:bg-vsc-input-background">
                <td className="p-2 border border-lightgray">{day.day}</td>
                <td className="p-2 border border-lightgray">{day.generatedTokens.toLocaleString()}</td>
                <td className="p-2 border border-lightgray">{day.promptTokens.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex items-center gap-2">
          <h2 className="ml-2">{t('tokenConsumptionByModel')}</h2>
          <CopyIconButton
            text={generateTable(
              ([[t('model'), t('generatedTokens'), t('promptTokens')]] as any).concat(
                models.map((model) => [
                  model.model,
                  model.generatedTokens.toLocaleString(),
                  model.promptTokens.toLocaleString(),
                ]),
              ),
            )}
          />
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="overflow-wrap-anywhere border border-lightgray">
              <th className="p-2 text-left border border-lightgray">{t('model')}</th>
              <th className="p-2 text-left border border-lightgray">{t('generatedTokens')}</th>
              <th className="p-2 text-left border border-lightgray">{t('promptTokens')}</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <tr key={model.model} className="overflow-wrap-anywhere border border-lightgray hover:bg-vsc-input-background">
                <td className="p-2 border border-lightgray">{model.model}</td>
                <td className="p-2 border border-lightgray">{model.generatedTokens.toLocaleString()}</td>
                <td className="p-2 border border-lightgray">{model.promptTokens.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Stats;
