import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

import { vscInputBackground } from "../..";
import { useAppDispatch, useAppSelector } from "../../../redux/hooks";
import { selectCurrentToolCall } from "../../../redux/selectors/selectCurrentToolCall";
import { setSelectedBlockSettingsSection } from "../../../redux/slices/uiSlice";

import { LumpToolbar } from "./LumpToolbar";
import { SelectedSection } from "./sections/SelectedSection";

interface LumpProps {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const LumpDiv = ({ open, className, ...props }: React.HTMLAttributes<HTMLDivElement> & { open: boolean }) => (
  <div className={cn("ml-0.5 mr-px bg-vsc-input-background", className)} {...props} />
);

const ContentDiv = ({ 
  hasSection, 
  isVisible, 
  className,
  ...props 
}: React.HTMLAttributes<HTMLDivElement> & { 
  hasSection: boolean; 
  isVisible: boolean;
}) => (
  <div
    className={cn(
      "transition-[max-height,margin,opacity] duration-300 ease-in-out overflow-x-hidden overflow-y-auto",
      hasSection ? "max-h-[70vh] my-1" : "max-h-0 my-0",
      isVisible ? "opacity-100" : "opacity-0",
      className
    )}
    {...props}
  />
);

export function Lump(props: LumpProps) {
  const { open, setOpen } = props;
  const dispatch = useAppDispatch();
  const selectedSection = useAppSelector(
    (state) => state.ui.selectedBlockSettingsSection,
  );
  const [displayedSection, setDisplayedSection] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const pendingToolCall = useAppSelector(selectCurrentToolCall);
  const keepToolsVisible =
    pendingToolCall?.status === "generated" &&
    selectedSection === "tools";
  const setSelectedSection = (value: string | null) => {
    dispatch(setSelectedBlockSettingsSection(value));
  };

  useEffect(() => {
    if (selectedSection) {
      setDisplayedSection(selectedSection);
      setIsVisible(true);
    } else {
      setIsVisible(false);
      // Delay clearing the displayed section until after the fade-out
      const timeout = setTimeout(() => {
        setDisplayedSection(null);
      }, 300); // Match the transition duration
      return () => clearTimeout(timeout);
    }
  }, [selectedSection]);

  if (!open) {
    return null;
  }

  return (
    <LumpDiv open={open}>
      <div className="mt-0.5 px-2">
        <LumpToolbar
          selectedSection={selectedSection}
          setSelectedSection={setSelectedSection}
        />

        <ContentDiv
          className="scrollbar-thin scrollbar-thumb-vsc-input-border scrollbar-track-transparent pr-0.5 hover:scrollbar-thumb-knoxcyan/50"
          hasSection={!!selectedSection}
          isVisible={isVisible}
        >
          {(!isStreaming || keepToolsVisible) && (
            <SelectedSection selectedSection={displayedSection} />
          )}
        </ContentDiv>
      </div>
    </LumpDiv>
  );
}
