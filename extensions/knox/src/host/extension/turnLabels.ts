import { turnIntents, deriveCheckpointLabel } from "core/context/soul/turnIntent";
import { extractSoulFiles } from "core/context/soul/extractToolFiles";
import { shouldVerifyTool } from "core/tools/postEditVerification";

export interface TurnToolLike {
  name: string;
  args?: unknown;
  status: string;
}

/**
 * MC-60: `finishNativeTurn` hook. Labels the checkpoints this turn created with a summary of the
 * intent and the files its mutating tools touched. Best-effort: never throws, never blocks the turn.
 */
export async function labelTurnCheckpoints(sessionId: string, tools: readonly TurnToolLike[]): Promise<void> {
  const turn = turnIntents.finish(sessionId);
  if (!turn || turn.checkpointIds.length === 0) return;
  try {
    const files = tools
      .filter((tool) => tool.status === "done" && shouldVerifyTool(tool.name))
      .flatMap((tool) => extractSoulFiles(tool.name, tool.args as never));
    const label = deriveCheckpointLabel({ intent: turn.intent, files });
    if (!label) return;
    const { CheckpointManager } = await import("../checkpoints/CheckpointManager");
    const manager = CheckpointManager.getInstance();
    for (const id of turn.checkpointIds) await manager.setCheckpointLabel(id, label);
  } catch (error) {
    console.warn("[Checkpoints] Labeling failed:", error instanceof Error ? error.message : error);
  }
}
