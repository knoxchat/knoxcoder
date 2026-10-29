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
    description: `Create, list, diff, preview, pin, restore, delete, or branch workspace file checkpoints (not Memory Brain snapshots).

Use this when the user asks to rewind files, mark a restore point, compare to a saved workspace state, park dirty files, follow a file across renames, or switch a checkpoint line.
- list: recent checkpoints (id, label, branch, time, file count)
- create: snapshot the current workspace (optional label)
- create_branch: fork a checkpoint line (not git) at a snapshot
- switch_branch: check out a checkpoint line's head (always asks). Dirty files are stashed first.
- checkout: check out one checkpoint (detached if it is not a branch head; always asks). Dirty files are stashed first.
- cherry_pick: apply one checkpoint's delta onto the current line (always asks). Conflicts write markers and leave HEAD unchanged.
- revert: apply the inverse of one checkpoint onto the current line (always asks). Later turns stay. Conflicts write markers and leave HEAD unchanged.
- merge_continue: finish an in-progress merge / cherry-pick / revert after conflicts are resolved (always asks).
- merge_abort: restore the pre-merge tree and clear merge state (always asks).
- diff: file list + hunk counts vs the live workspace or another checkpoint (no writes)
- preview_restore: restore-oriented file list + hunk counts vs the live workspace (no writes)
- pin / unpin: keep or allow eviction of a checkpoint
- restore: rewind files to a checkpoint id (always asks the user; never auto-run). Set rewind_memory=true to also roll back Memory Brain and later episodic turns.
- delete: remove a checkpoint (always asks the user; never auto-run)
- stash: park dirty files, then restore the current checkpoint head (always asks). Optional label is the stash note.
- stash_list: stash stack (id, note, file count). No writes.
- stash_pop: apply the latest stash (or stash_id) and drop it (always asks). Conflicts leave the working tree unchanged.
- file_history: unique versions of one path, following renames (readonly). Set follow=false for path-exact.
- blame: per-line origin table for one path (readonly). Follows renames. Binary files are unsupported.
- materialize_worktree: reconstruct a checkpoint into an isolated folder outside the project (always asks).
- remove_worktree: delete a materialized worktree (always asks).
- list_worktrees: registered isolated worktrees (readonly).
- bisect_start / bisect_good / bisect_bad / bisect_skip / bisect_reset / bisect_run: binary-search a regression in a worktree (always ask).
- export_patch: unified diff for one checkpoint vs its parent (readonly). Includes Knox trailer. Skips binary files.
- apply_patch: apply a unified patch onto the live tree via three-way merge (always asks). Success creates a checkpoint tagged patch. Conflicts write nothing.

Prefer this over shell git reset for agent-created snapshots. Memory Brain entries are builtin_memory, not this tool.`,
    parameters: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: [
            "list",
            "create",
            "create_branch",
            "switch_branch",
            "checkout",
            "cherry_pick",
            "revert",
            "merge_continue",
            "merge_abort",
            "diff",
            "preview_restore",
            "pin",
            "unpin",
            "restore",
            "delete",
            "stash",
            "stash_list",
            "stash_pop",
            "file_history",
            "blame",
            "materialize_worktree",
            "remove_worktree",
            "list_worktrees",
            "bisect_start",
            "bisect_good",
            "bisect_bad",
            "bisect_skip",
            "bisect_reset",
            "bisect_run",
            "export_patch",
            "apply_patch",
          ],
          description:
            "list | create | create_branch | switch_branch | checkout | cherry_pick | revert | merge_continue | merge_abort | diff | preview_restore | pin | unpin | restore | delete | stash | stash_list | stash_pop | file_history | blame | materialize_worktree | remove_worktree | list_worktrees | bisect_start | bisect_good | bisect_bad | bisect_skip | bisect_reset | bisect_run | export_patch | apply_patch",
        },
        name: {
          type: "string",
          description: "[create_branch | switch_branch] Checkpoint-line name (not git)",
        },
        branch_id: {
          type: "string",
          description: "[switch_branch] Branch id from list / create_branch. Used when name is omitted",
        },
        label: {
          type: "string",
          description:
            "[create] Optional checkpoint description. [create_branch] Optional branch note. [stash] Optional stash note",
        },
        stash_id: {
          type: "string",
          description:
            "[stash_pop] Stash id from stash_list. Defaults to the latest stash when omitted",
        },
        checkpoint_id: {
          type: "string",
          description:
            "[diff | preview_restore | pin | unpin | restore | delete | create_branch | checkout | cherry_pick | revert | materialize_worktree | export_patch] Checkpoint id from list. create_branch defaults to the newest checkpoint when omitted",
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
        path: {
          type: "string",
          description:
            "[file_history | blame] Workspace-relative path. Follows renames unless follow=false.",
        },
        at_checkpoint_id: {
          type: "string",
          description:
            "[blame] Blame the file as of this checkpoint instead of the live workspace.",
        },
        worktree_id: {
          type: "string",
          description: "[remove_worktree] Worktree id from list_worktrees",
        },
        good_checkpoint_id: {
          type: "string",
          description: "[bisect_start] Known-good ancestor. Defaults to the branch base.",
        },
        command: {
          type: "string",
          description: "[bisect_run] Oracle command in the bisect worktree. Exit 0 = good, 1–127 = bad, 125 = skip.",
        },
        patch: {
          type: "string",
          description: "[apply_patch] Unified diff text (git-style headers + X-Knox-Checkpoint trailer).",
        },
        follow: {
          type: "boolean",
          description:
            "[file_history] Walk renamedFrom / similarity (default true).",
        },
        limit: {
          type: "number",
          description: "[list] Max rows (default 15, max 50)",
        },
      },
    },
  },
};
