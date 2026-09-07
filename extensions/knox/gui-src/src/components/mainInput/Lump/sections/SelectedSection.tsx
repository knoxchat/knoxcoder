import { CheckpointsSection } from "./CheckpointsSection";
import { ContextSection } from "./ContextSection";
import { HistorySection } from "./HistorySection";
import { ModelsSection } from "./ModelsSection";
import { PromptsSection } from "./PromptsSection";
import { RulesSection } from "./RulesSection";
import { ToolsSection } from "./ToolsSection";

interface SelectedSectionProps {
  selectedSection: string | null;
}

export function SelectedSection(props: SelectedSectionProps) {
  switch (props.selectedSection) {
    case "models":
      return <ModelsSection />;
    case "rules":
      return <RulesSection />;
    case "prompts":
      return <PromptsSection />;
    case "context":
      return <ContextSection />;
    case "tools":
      return <ToolsSection />;
    case "history":
      return <HistorySection />;
    case "checkpoints":
      return <CheckpointsSection />;
    default:
      return null;
  }
}
