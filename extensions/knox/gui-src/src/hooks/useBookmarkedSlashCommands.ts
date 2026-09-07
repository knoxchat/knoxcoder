import { SlashCommandDescription } from "core";

import {
  bookmarkSlashCommand,
  selectBookmarkedSlashCommands,
  unbookmarkSlashCommand,
} from "../redux";
import { useAppDispatch, useAppSelector } from "../redux/hooks";

export function useBookmarkedSlashCommands() {
  const dispatch = useAppDispatch();
  const bookmarkedCommands = useAppSelector(selectBookmarkedSlashCommands);

  const isCommandBookmarked = (commandName: string): boolean => {
    return bookmarkedCommands.includes(commandName);
  };

  const toggleBookmark = (command: SlashCommandDescription) => {
    const isBookmarked = isCommandBookmarked(command.name);

    if (isBookmarked) {
      dispatch(
        unbookmarkSlashCommand({
          commandName: command.name,
        }),
      );
    } else {
      dispatch(
        bookmarkSlashCommand({
          commandName: command.name,
        }),
      );
    }
  };

  return {
    isCommandBookmarked,
    toggleBookmark,
  };
}
