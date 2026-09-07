import React from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeftIcon } from "../../svg-icons";
import { lightGray, vscBackground } from "../../components";
import { useNavigationListener } from "../../hooks/useNavigationListener";

/**
 * Local token/billing stats were removed — KnoxChat tracks usage at the provider.
 */
function TokenDashboard() {
  const { t } = useTranslation();
  useNavigationListener();
  const navigate = useNavigate();

  return (
    <div style={{ backgroundColor: vscBackground }} className="min-h-screen">
      <div
        onClick={() => navigate(-1)}
        className="sticky top-0 m-0 flex cursor-pointer items-center p-0 z-10"
        style={{
          backgroundColor: vscBackground,
          borderBottom: `1px solid ${lightGray}`,
        }}
      >
        <ArrowLeftIcon className="ml-3 h-4 w-4" />
        <span className="m-2 text-sm font-semibold">{t("tokenUsageDashboard")}</span>
      </div>

      <div className="mx-auto max-w-xl p-6 text-sm opacity-80">
        <p>{t("tokenUsageKnoxChatBilling")}</p>
      </div>
    </div>
  );
}

export default TokenDashboard;
