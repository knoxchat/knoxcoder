import { ContextItemWithId, ToolCall, ToolCallDelta, ToolCallState } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";
import { useTranslation } from "react-i18next";

import { AskUser } from "./AskUser";
import { CreateFile } from "./CreateFile";
import { displayBuildCommand } from "./displayBuildCommand";
import { GenericCodePreview } from "./GenericCodePreview";
import { RunTerminalCommand } from "./RunTerminalCommand";
import { TaskSubagent } from "./TaskSubagent";
import { ViewSubdirectory } from "./ViewSubdirectory";
import { ViewRepoMap } from "./ViewRepoMap";
import { ExactSearch } from "./ExactSearch";

function FunctionSpecificToolCallDiv({
  toolCall,
  toolCallState,
  toolOutputContextItems,
}: {
  toolCall: ToolCallDelta;
  toolCallState: ToolCallState;
  toolOutputContextItems: ContextItemWithId[];
}) {
  const { t } = useTranslation();
  const args = toolCallState.parsedArgs;

  switch (toolCall.function?.name) {
    case BuiltInToolNames.CreateNewFile:
      return (
        <CreateFile
          toolCall={toolCall}
          toolCallState={toolCallState}
          relativeFilepath={args.filepath}
          fileContents={args.contents}
        />
      );
    case BuiltInToolNames.RunTerminalCommand:
      return (
        <RunTerminalCommand
          command={args.command}
          toolCallState={toolCallState}
          toolOutputContextItems={toolOutputContextItems}
        />
      );
    case BuiltInToolNames.Build:
      return (
        <RunTerminalCommand
          command={displayBuildCommand(args)}
          toolCallState={toolCallState}
          toolOutputContextItems={toolOutputContextItems}
        />
      );
    case BuiltInToolNames.AwaitShell:
      return (
        <RunTerminalCommand
          command={
            args.job_id
              ? args.kill
                ? t("jobsKillCommand", { id: args.job_id })
                : t("jobsAwaitCommand", { id: args.job_id })
              : t("jobsListCommand")
          }
          toolCallState={toolCallState}
          toolOutputContextItems={toolOutputContextItems}
        />
      );
    case BuiltInToolNames.PtyStart:
      return (
        <RunTerminalCommand
          command={args.command}
          toolCallState={toolCallState}
          toolOutputContextItems={toolOutputContextItems}
        />
      );
    case BuiltInToolNames.PtySend:
      return (
        <RunTerminalCommand
          command={
            args.job_id
              ? `pty send ${args.job_id}`
              : "pty send"
          }
          toolCallState={toolCallState}
          toolOutputContextItems={toolOutputContextItems}
        />
      );
    case BuiltInToolNames.PtyRead:
      return (
        <RunTerminalCommand
          command={
            args.job_id
              ? args.kill
                ? t("jobsKillCommand", { id: args.job_id })
                : `pty read ${args.job_id}`
              : "pty read"
          }
          toolCallState={toolCallState}
          toolOutputContextItems={toolOutputContextItems}
        />
      );
    case BuiltInToolNames.Qemu:
      return (
        <RunTerminalCommand
          command={
            args.action === "start"
              ? args.command ||
                `qemu ${args.kernel || args.arch || "session"}`
              : args.job_id
                ? `qemu ${args.action || "status"} ${args.job_id}`
                : `qemu ${args.action || "session"}`
          }
          toolCallState={toolCallState}
          toolOutputContextItems={toolOutputContextItems}
        />
      );
    case BuiltInToolNames.Debug:
      return (
        <RunTerminalCommand
          command={`debug ${args.op || "session"}`}
          toolCallState={toolCallState}
          toolOutputContextItems={toolOutputContextItems}
        />
      );
    case BuiltInToolNames.ViewSubdirectory:
      return (
        <ViewSubdirectory
          directory_path={args.directory_path}
          depth={args.depth}
          fileTypes={args.fileTypes}
          pattern={args.pattern}
          includeStats={args.includeStats}
          includeGitStatus={args.includeGitStatus}
          sortBy={args.sortBy}
          outputFormat={args.outputFormat}
          toolCallState={toolCallState}
          toolOutputContextItems={toolOutputContextItems}
        />
      );
    case BuiltInToolNames.ViewRepoMap:
      return (
        <ViewRepoMap
          toolCallState={toolCallState}
          toolOutputContextItems={toolOutputContextItems}
        />
      );
    case BuiltInToolNames.AskUser:
      return <AskUser toolCallState={toolCallState} />;
    case BuiltInToolNames.Task:
      return (
        <TaskSubagent
          toolCallState={toolCallState}
          toolOutputContextItems={toolOutputContextItems}
        />
      );
    case BuiltInToolNames.ExactSearch:
      return (
        <ExactSearch
          query={args.query}
          toolCallState={toolCallState}
          toolOutputContextItems={toolOutputContextItems}
        />
      );
    default:
      return (
        <GenericCodePreview
          toolCall={toolCall}
          toolCallState={toolCallState}
        />
      );
  }
}

export default FunctionSpecificToolCallDiv;