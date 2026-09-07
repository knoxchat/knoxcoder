import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  History,
  Info,
  RotateCcw,
  Settings,
  Share2,
  type LucideIcon,
} from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { cn } from "@/lib/utils";
import { CheckpointConfig } from "./CheckpointConfig";
import { ConnectedCheckpointAnalysisPanel } from "./CheckpointAnalysisPanel";
import { ConnectedCollaborativePanel } from "./CollaborativePanel";
import { ConnectedCheckpointTimeline } from "./CheckpointTimeline";
import { ConnectedPerformanceDashboard } from "./PerformanceDashboard";
import { Checkpoints } from ".";
import { CP_ICON, compactTabsListClass, compactTabsTriggerClass } from "./checkpointUi";

type TabId = "checkpoints" | "timeline" | "analysis" | "configuration" | "dashboard" | "share";

type TabOption = {
  id: TabId;
  label: string;
  render: () => React.ReactNode;
  icon: LucideIcon;
};

interface CheckpointsPanelProps {
  /** Optional initial tab when the panel opens */
  initialTabId?: TabId;
  /** When false, omit outer horizontal padding (Lump overlay already pads) */
  padded?: boolean;
}

export function CheckpointsPanel({
  initialTabId = "checkpoints",
  padded = true,
}: CheckpointsPanelProps) {
  const { t } = useTranslation();
  const [activeTabId, setActiveTabId] = useState<TabId>(initialTabId);

  const tabs: TabOption[] = [
    { id: "checkpoints", label: t("checkpoints"), render: () => <Checkpoints />, icon: RotateCcw },
    { id: "timeline", label: t("checkpointTimeline.tab"), render: () => <ConnectedCheckpointTimeline />, icon: History },
    { id: "analysis", label: t("checkpointAnalysis.tab"), render: () => <ConnectedCheckpointAnalysisPanel />, icon: Info },
    { id: "dashboard", label: t("checkpointDashboard.tab"), render: () => <ConnectedPerformanceDashboard />, icon: BarChart3 },
    { id: "share", label: t("checkpointShare.tab"), render: () => <ConnectedCollaborativePanel />, icon: Share2 },
    { id: "configuration", label: t("configuration"), render: () => <CheckpointConfig />, icon: Settings },
  ];

  return (
    <Tabs
      value={activeTabId}
      onValueChange={(value) => setActiveTabId(value as TabId)}
      className="@container flex h-full min-h-0 flex-col gap-0"
    >
      <div className="border-border/60 shrink-0 border-b px-0.5 py-0.5">
        <TabsList className={compactTabsListClass}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                title={tab.label}
                className={cn(
                  compactTabsTriggerClass,
                  "data-[state=active]:text-knoxcyan",
                )}
              >
                <Icon className={CP_ICON} />
                <span className="sr-only @[26rem]:not-sr-only @[26rem]:inline">
                  {tab.label}
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>

      {tabs.map((tab) => (
        <TabsContent
          key={tab.id}
          value={tab.id}
          className={cn(
            "mt-0 min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden focus-visible:ring-0",
            padded ? "px-3" : "",
          )}
        >
          {activeTabId === tab.id ? tab.render() : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}
