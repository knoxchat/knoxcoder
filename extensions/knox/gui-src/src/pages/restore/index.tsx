import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { CheckpointsPanel } from "../../components/Checkpoints/CheckpointsPanel";
import { PageHeader } from "../../components/PageHeader";

/**
 * Full-page restore view kept for deep links / backwards compatibility.
 * Primary UX is the in-chat Checkpoints overlay (Lump toolbar).
 */
export default function RestorePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="bg-vsc-background sticky top-0 z-10">
        <PageHeader
          showBorder
          onTitleClick={() => navigate("/")}
          title={t("backToChat")}
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        <CheckpointsPanel />
      </div>
    </div>
  );
}
