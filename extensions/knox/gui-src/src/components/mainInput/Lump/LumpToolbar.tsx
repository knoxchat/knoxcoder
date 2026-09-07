import { BlockSettingsTopToolbar } from "./BlockSettingsTopToolbar";

interface TopToolbarProps {
  selectedSection: string | null;
  setSelectedSection: (value: string | null) => void;
}

export function LumpToolbar(props: TopToolbarProps) {
  return (
    <BlockSettingsTopToolbar
      selectedSection={props.selectedSection}
      setSelectedSection={props.setSelectedSection}
    />
  );
}
