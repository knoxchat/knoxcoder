import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { PageHeader } from "../../components/PageHeader";
import { BrainIcon, DatabaseIcon, SettingsIcon } from "../../svg-icons";
import { fontSize } from "../../util";
import { MemoryOverview } from "./MemoryOverview";
import { MemoryBrowser } from "./MemoryBrowser";
import { KnowledgeGraphView } from "./KnowledgeGraphView";
import { MemorySettings } from "./MemorySettings";
import { MemorySessionHistory } from "./MemorySessionHistory";

type TabOption = {
  id: string;
  label: string;
  component: React.ReactNode;
  icon: React.ReactNode;
};

export default function MemoryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activeTabId, setActiveTabId] = useState("overview");

  const tabs: TabOption[] = [
    {
      id: "overview",
      label: t("memoryOverview"),
      component: <MemoryOverview />,
      icon: <span><BrainIcon /></span>,
    },
    {
      id: "memories",
      label: t("memoryBrowser"),
      component: <MemoryBrowser />,
      icon: <span><DatabaseIcon /></span>,
    },
    {
      id: "sessions",
      label: t("memorySessionHistoryTab"),
      component: <MemorySessionHistory />,
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
    {
      id: "graph",
      label: t("memoryGraph"),
      component: <KnowledgeGraphView />,
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="5" cy="6" r="3" /><circle cx="19" cy="6" r="3" /><circle cx="12" cy="18" r="3" />
          <path d="M7.5 8l4 7.5M16.5 8l-4 7.5" />
        </svg>
      ),
    },
    {
      id: "settings",
      label: t("memorySettings"),
      component: <MemorySettings />,
      icon: <span><SettingsIcon /></span>,
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="bg-vsc-background shrink-0">
        <PageHeader
          showBorder
          onTitleClick={() => navigate("/")}
          title={t("backToChat")}
        />

        {/* Tab Headers */}
        <div className="border-0 border-b border-solid p-0.5 sm:flex sm:justify-center md:gap-x-2">
          {tabs.map((tab) => (
            <div
              style={{ fontSize: fontSize(-2) }}
              key={tab.id}
              className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-2 transition-colors ${
                activeTabId === tab.id
                  ? "bg-vsc-input-background text-knoxcyan"
                  : "hover:bg-vsc-list-hoverBackground"
              }`}
              onClick={() => setActiveTabId(tab.id)}
            >
              {tab.icon}
              {tab.label}
            </div>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4">
        {tabs.find((tab) => tab.id === activeTabId)?.component}
      </div>
    </div>
  );
}
