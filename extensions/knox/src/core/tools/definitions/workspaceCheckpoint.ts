import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const workspaceCheckpointTool: Tool = {
  type: "function",
  displayTitle: "Workspace checkpoint",
  wouldLikeTo: "{{{ action }}} a workspace checkpoint",
  isCurrently: "managing a workspace checkpoint",
  hasAlready: "managed a workspace checkpoint",
  group: BUILT_IN_GROUP_NAME,
  readonly: false,
  function: {
    name: BuiltInToolNames.WorkspaceCheckpoint,
    description: `Create, list, diff, preview, pin, restore, or delete workspace file checkpoints (not Memory Brain snapshots).

Use this when the user asks to rewind files, mark a restore point, or compare to a saved workspace state.
- list: recent checkpoints (id, description, time, file count)
- create: snapshot the current workspace (optional label)
- diff: file list + hunk counts vs the live workspace or another checkpoint (no writes)
- preview_restore: restore-oriented file list + hunk counts vs the live workspace (no writes)
- pin / unpin: keep or allow eviction of a checkpoint
- restore: rewind files to a checkpoint id (always asks the user; never auto-run). Set rewind_memory=true to also roll back Memory Brain and later episodic turns.
- delete: remove a checkpoint (always asks the user; never auto-run)

Prefer this over shell git reset for agent-created snapshots. Memory-only rollback is builtin_memory_manage.`,
    parameters: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: [
            "list",
            "create",
            "diff",
            "preview_restore",
            "pin",
            "unpin",
            "restore",
            "delete",
          ],
          description:
            "list | create | diff | preview_restore | pin | unpin | restore | delete",
        },
        label: {
          type: "string",
          description: "[create] Optional checkpoint description",
        },
        checkpoint_id: {
          type: "string",
          description:
            "[diff | preview_restore | pin | unpin | restore | delete] Checkpoint id from list",
        },
        compare_to_checkpoint_id: {
          type: "string",
          description:
            "[diff] Other checkpoint id. Defaults to the previous checkpoint when omitted.",
        },
        compare_to_workspace: {
          type: "boolean",
          description:
            "[diff] Compare against the live workspace instead of another checkpoint. Default false.",
        },
        rewind_memory: {
          type: "boolean",
          description:
            "[restore] Also rewind Memory Brain and later episodic turns. Default false — restore stays an explicit mode.",
        },
        limit: {
          type: "number",
          description: "[list] Max rows (default 15, max 50)",
        },
      },
    },
  },
};
