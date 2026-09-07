import { SlashCommandDescription } from "core";
import { MessageSquare } from "lucide-react";

import { getNamedIcon } from "../mainInput/icons";

interface ConversationStarterCardProps {
  command: SlashCommandDescription;
  onClick: (command: SlashCommandDescription) => void;
}

export function ConversationStarterCard({
  command,
  onClick,
}: ConversationStarterCardProps) {
  const Icon = getNamedIcon(command.name) ?? MessageSquare;

  return (
    <div
      className="bg-vsc-input-background mb-2 w-full rounded-md shadow-md hover:cursor-pointer hover:brightness-110"
      onClick={() => onClick(command)}
    >
      <div className="flex px-3 py-1.5">
        <div className="mr-3 shrink-0 self-start pt-0.5">
          <span className="text-knoxcyan h-3 w-3">
            <Icon className="h-3 w-3" height="0.75rem" width="0.75rem" />
          </span>
        </div>
        <div className="flex flex-1 flex-col justify-center">
          <div className="text-xs font-medium">{command.name}</div>
          {command.description && (
            <div className="text-lightgray text-xs">{command.description}</div>
          )}
        </div>
      </div>
    </div>
  );
}
