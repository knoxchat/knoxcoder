import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { PageHeader } from "../../components/PageHeader";
import { useNavigationListener } from "../../hooks/useNavigationListener";
import { SettingsIcon } from "../../svg-icons";
import { fontSize } from "../../util";

import { UserSettingsForm } from "./UserSettingsForm";

type TabOption = {
  id: string;
  label: string;
  component: React.ReactNode;
  icon: React.ReactNode;
};

function ConfigPage() {
  const { t } = useTranslation();
  useNavigationListener();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<string>("settings");

  const tabs: TabOption[] = [
    {
      id: "settings",
      label: t('settings'),
      component: <UserSettingsForm />,
      icon: (
        <span>
          <SettingsIcon />
        </span>
      ),
    }
  ];

  // Find the active tab component
  const activeComponent = tabs.find(tab => tab.id === activeTab)?.component || <UserSettingsForm />;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="bg-vsc-background sticky top-0 z-10">
        <PageHeader
          showBorder
          onTitleClick={() => navigate("/")}
          title={t('backToChat')}
        />

        {/* Tab Headers */}
        <div className="border-0 border-b border-solid border-b-zinc-700 p-0.5 sm:flex sm:justify-center md:gap-x-2">
          {tabs.map((tab) => (
            <div
              style={{
                fontSize: fontSize(-2),
              }}
              key={tab.id}
              className={`hover:bg-vsc-input-background flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-2 ${activeTab === tab.id ? 'bg-vsc-input-background' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.icon}
              {tab.label}
            </div>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto px-4">
        {activeComponent}
      </div>
    </div>
  );
}

export default ConfigPage;
