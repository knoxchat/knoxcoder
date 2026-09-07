import { Bookmark } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import { GhostButton } from "../../../../components";
import AddPromptDialog from "../../../../components/dialogs/AddPromptDialog";
import { useBookmarkedSlashCommands } from "../../../../hooks/useBookmarkedSlashCommands";
import { useAppDispatch, useAppSelector } from "../../../../redux/hooks";
import { setDialogMessage, setShowDialog } from "../../../../redux/slices/uiSlice";
import { AddIcon, PencilSquareIcon } from "../../../../svg-icons";
import { fontSize } from "../../../../util";

interface PromptRowProps {
  command: string;
  description: string;
  isBookmarked: boolean;
  setIsBookmarked: (isBookmarked: boolean) => void;
  onEdit?: () => void;
}

function PromptRow({
  command,
  description,
  isBookmarked,
  setIsBookmarked,
  onEdit,
}: PromptRowProps) {
  return (
    <div
      className="flex items-center justify-between gap-3"
      style={{
        fontSize: fontSize(-3),
      }}
    >
      <div className="flex min-w-0 gap-2">
        <span className="text-vscForeground shrink-0">{command}</span>
        <span className="truncate text-knoxcyan">{description}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 cursor-pointer hover:brightness-125"
          onClick={onEdit}>
            <PencilSquareIcon />
          </span>
        <div
          onClick={() => setIsBookmarked(!isBookmarked)}
          className="cursor-pointer pt-0.5 text-knoxcyan hover:brightness-125"
        >
          <Bookmark className={`h-3 w-3 ${isBookmarked ? 'fill-current' : ''}`} />
        </div>
      </div>
    </div>
  );
}

export function PromptsSection() {
  const { t } = useTranslation();
  const { isCommandBookmarked, toggleBookmark } = useBookmarkedSlashCommands();
  const dispatch = useAppDispatch();
  const slashCommands = useAppSelector(
    (state) => state.config.config.slashCommands ?? [],
  );

  const handleEdit = (prompt: any) => {
    // Open the dialog with existing prompt data for editing
    dispatch(setShowDialog(true));
    dispatch(
      setDialogMessage(
        React.createElement(AddPromptDialog, {
          existingPrompt: {
            name: prompt.name,
            description: prompt.description,
            prompt: prompt.prompt
          }
        })
      )
    );
  };

  const handleAddPrompt = () => {
    dispatch(setShowDialog(true));
    dispatch(setDialogMessage(React.createElement(AddPromptDialog, {})));
  };

  const sortedCommands = [...slashCommands].sort((a, b) => {
    const aBookmarked = isCommandBookmarked(a.name);
    const bBookmarked = isCommandBookmarked(b.name);
    if (aBookmarked && !bBookmarked) {return -1;}
    if (!aBookmarked && bBookmarked) {return 1;}
    return 0;
  });

  return (
    <div className="flex flex-col gap-1">
      {sortedCommands.map((prompt) => (
        <PromptRow
          key={prompt.name}
          command={prompt.name}
          description={prompt.description}
          isBookmarked={isCommandBookmarked(prompt.name)}
          setIsBookmarked={() => toggleBookmark(prompt)}
          onEdit={() => handleEdit(prompt)}
        />
      ))}
      
      {/* Custom add prompt button */}
      <GhostButton
        className="w-full cursor-pointer rounded-sm px-2 text-center text-knoxcyan hover:text-gray-300"
        style={{
          fontSize: fontSize(-3),
        }}
        onClick={(e) => {
          e.preventDefault();
          handleAddPrompt();
        }}
      >
        <div className="flex items-center justify-center gap-1 text-knoxcyan">
          <AddIcon className="h-3 w-3" /> {t('addPrompt')}
        </div>
      </GhostButton>
    </div>
  );
}
