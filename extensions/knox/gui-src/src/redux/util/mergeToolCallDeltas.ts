import { ToolCallDelta, ToolCallState } from "core";
import { resolveBuiltInToolName } from "core/tools/builtIn";
import { incrementalParseJson } from "core/util/incrementalParseJson";

/** Merge streamed tool-call deltas by `index` (OpenAI) or `id` (Anthropic). */
export function mergeToolCallDeltas(
  existing: ToolCallDelta[],
  incoming: ToolCallDelta[],
): ToolCallDelta[] {
  const next: ToolCallDelta[] = existing.map((toolCall) => ({
    ...toolCall,
    function: {
      name: toolCall.function?.name ?? "",
      arguments: toolCall.function?.arguments ?? "",
    },
  }));

  for (let i = 0; i < incoming.length; i++) {
    const delta = incoming[i];
    let target = -1;
    if (typeof delta.index === "number" && delta.index >= 0) {
      target = delta.index;
    } else if (delta.id) {
      target = next.findIndex((toolCall) => toolCall.id === delta.id);
    }
    if (target < 0) {
      target = next.length;
    }
    while (next.length <= target) {
      next.push({
        type: "function",
        function: { name: "", arguments: "" },
      });
    }
    const current = next[target];
    if (delta.id) {
      current.id = delta.id;
    }
    if (delta.type) {
      current.type = delta.type;
    }
    if (typeof delta.index === "number") {
      current.index = delta.index;
    }
    current.function = {
      name: delta.function?.name || current.function?.name || "",
      arguments:
        (current.function?.arguments ?? "") +
        (delta.function?.arguments ?? ""),
    };
  }

  return next;
}

export function toolCallDeltaToState(toolCallDelta: ToolCallDelta): ToolCallState {
  const [_, parsedArgs] = incrementalParseJson(
    toolCallDelta.function?.arguments ?? "{}",
  );
  const rawName = toolCallDelta.function?.name ?? "";
  return {
    status: "generating",
    toolCall: {
      id: toolCallDelta.id ?? "",
      type: toolCallDelta.type ?? "function",
      function: {
        name: resolveBuiltInToolName(rawName) || rawName,
        arguments: toolCallDelta.function?.arguments ?? "",
      },
    },
    toolCallId: toolCallDelta.id ?? "",
    parsedArgs,
  };
}

export function syncToolCallStatesFromDeltas(
  deltas: ToolCallDelta[],
  previous: ToolCallState[] | undefined,
): ToolCallState[] {
  return deltas.map((delta, index) => {
    const prev =
      previous?.find((state) => state.toolCallId && state.toolCallId === delta.id) ??
      previous?.[index];
    const next = toolCallDeltaToState(delta);
    if (!prev) {
      return next;
    }
    return {
      ...prev,
      toolCallId: next.toolCallId || prev.toolCallId,
      parsedArgs: next.parsedArgs,
      toolCall: next.toolCall,
    };
  });
}

export function primaryToolCallState(
  states: ToolCallState[] | undefined,
): ToolCallState | undefined {
  if (!states?.length) {
    return undefined;
  }
  return (
    states.find(
      (state) =>
        state.status === "calling" ||
        state.status === "generated" ||
        state.status === "generating",
    ) ?? states[states.length - 1]
  );
}
