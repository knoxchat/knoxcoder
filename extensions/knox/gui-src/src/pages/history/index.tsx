import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { History } from "../../components/History";
import { PageHeader } from "../../components/PageHeader";
import { HistoryIcon } from "../../svg-icons";
import { fontSize } from "../../util";

type TabOption = {
  id: string;
  label: string;
  component: React.ReactNode;
  icon: React.ReactNode;
};

export default function HistoryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const tabs: TabOption[] = [
    {
      id: "history",
      label: t('conversationHistory'),
      component: <History />,
      icon: (
        <span>
          <HistoryIcon />
        </span>
      ),
    },
  ];

  return (
    <div className="@container flex h-full min-w-0 flex-col overflow-x-hidden overflow-y-auto">
      <div className="bg-vsc-background sticky top-0 z-10 min-w-0">
        <PageHeader
          showBorder
          onTitleClick={() => navigate("/")}
          title={t('backToChat')}
        />

        <div className="flex min-w-0 justify-center gap-x-1 overflow-x-hidden border-0 border-b border-solid border-b-zinc-700 p-0.5 @[24rem]:gap-x-2">
          {tabs.map((tab) => (
            <div
              style={{
                fontSize: fontSize(-2),
              }}
              key={tab.id}
              className="bg-vsc-input-background flex min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-2"
            >
              {tab.icon}
              <span className="min-w-0 truncate">{tab.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-2 @[24rem]:px-4">
        <History />
      </div>
    </div>
  );
}
