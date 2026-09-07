import { ContextItemWithId, ToolCallState } from "core";

export function TaskSubagent({
  toolCallState,
  toolOutputContextItems,
}: {
  toolCallState: ToolCallState;
  toolOutputContextItems: ContextItemWithId[];
}) {
  const profile =
    typeof toolCallState.parsedArgs?.profile === "string"
      ? toolCallState.parsedArgs.profile
      : "explore";
      const prompt =
        typeof toolCallState.parsedArgs?.prompt === "string"
          ? toolCallState.parsedArgs.prompt
          : "";
      const explores = Array.isArray(toolCallState.parsedArgs?.explores)
        ? toolCallState.parsedArgs.explores.length
        : 0;
      const output = toolOutputContextItems[0]?.content;

      return (
        <div className="flex flex-col gap-2 px-2 pb-2 text-sm">
          <div className="text-lightgray">
            {profile}
            {explores > 1 ? ` ×${explores}` : ""}
            {prompt ? ` — ${prompt.slice(0, 160)}${prompt.length > 160 ? "…" : ""}` : ""}
          </div>
      {output ? (
        <pre className="bg-vsc-input-background max-h-64 overflow-auto whitespace-pre-wrap rounded-md p-2 text-xs">
          {output}
        </pre>
      ) : null}
    </div>
  );
}
