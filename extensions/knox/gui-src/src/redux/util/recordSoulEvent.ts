import type { IIdeMessenger } from "../../context/IdeMessenger";

export async function requestWorkspaceRestore(
  ideMessenger: IIdeMessenger,
  checkpointId: string,
  options?: { rewindMemory?: boolean },
): Promise<{
  success: boolean;
  message?: string;
  memoryRewound?: boolean;
  memoryMessage?: string;
}> {
  const response = await ideMessenger.request("restoreCheckpoint", {
    checkpointId,
    rewindMemory: options?.rewindMemory,
  });
  if (response.status === "success") {
    return response.content;
  }
  return { success: false, message: String(response.status) };
}

export function recordGuiSoulEvent(
  ideMessenger: IIdeMessenger | undefined,
  input: {
    sessionId?: string;
    kind: "tool_success" | "tool_denied" | "tool_error";
    toolName?: string;
    summary: string;
    policy?: "allow" | "ask" | "deny";
  },
): void {
  if (!ideMessenger || !input.sessionId) {
    return;
  }
  void ideMessenger
    .request("brain/recordSoulEvent", {
      sessionId: input.sessionId,
      kind: input.kind,
      toolName: input.toolName,
      files: [],
      ok: input.kind === "tool_success",
      policy: input.policy,
      summary: input.summary,
    })
    .catch(() => {});
}
