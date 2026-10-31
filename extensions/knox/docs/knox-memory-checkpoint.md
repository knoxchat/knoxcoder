<!-- Copyright (c) KnoxStudio. All rights reserved. Licensed under the GNU GPL-3.0 License. -->

# Knox memory ↔ checkpoint pairing

Contract for how Memory Brain, workspace file checkpoints, and recipes share identifiers **without becoming a second brain**.

This is the file `AGENTS.md` points at. The rewrite plan is [`memory-impl.md`](memory-impl.md). The math is the revised [KMS Unlimited Context Theorem](https://docs.knoxstudio.ai/knox-ms-unlimited-formula/): bounded context (`C_use ≤ W`), unbounded addressable memory (`C_addr`), measured recall (`Rec`). Retrieval stays **local lexical** (FTS / BM25 / trigrams / synonyms / graph / tree). No embeddings, vector index, or neural rerank.

---

## Three quantities (do not mix)

| Symbol | What it is here | What it is not |
| --- | --- | --- |
| `C_addr` | Stored rows in `M₃` (session / episodic), `M₄` (facts), `M₅` (recipes + linked workflow memories), counted **once** | Checkpoint blob bytes, gzip ratios, graph node count, `Σ \|Mᵢ\| / rᵢ` |
| `C_use(q)` | Tokens injected into one model call | A snapshot JSON dump or a reconstructed worktree |
| Pointer | A stable id the agent can retrieve and cite (`workspace_checkpoint_id`, `memoryCheckpointId`, recipe `sourceCheckpointIds`) | Extra context capacity |

Workspace checkpoints and brain snapshots are **rewind machinery and linkable pointers**. They are not `|checkpoint| / rᵢ` on the Overview dashboard. Graph, BM25, ripgrep, and the summary tree are **channels over the same rows**, not more storage.

---

## Three kinds (do not fold)

| Kind | Store | Role |
| --- | --- | --- |
| Workspace file CP | `extensions/knox/src/host/checkpoints/` (disk tree + blob store) | What the files were. Recipe **bytes** live here (`blob_hash` + `checkpoint_id`). Agent tool: `builtin_workspace_checkpoint`. |
| Brain knowledge CP | `brain_checkpoints` + a JSON/JSON.gz under `~/.knoxcoder/memory/` | Rewind pin of **knowledge tables** (semantic, graph, procedures, tags, recipes, outcomes, supersessions, attribution, summary tree). Episodic and sessions are **not** in the snapshot. |
| Link | `brain_checkpoints.workspace_checkpoint_id` | One action can restore files and rewind knowledge. |

Soul events (`recordSoulEvent`) are episodic rows that may **name** both ids. They are a 20-event in-memory ring plus sqlite episodic, not a summary tree over the checkpoint graph.

```
workspace CP  ──workspace_checkpoint_id──►  brain CP (rewind pin)
      │                                            │
      │ blob_hash / checkpoint_id                  │ snapshot_path
      ▼                                            ▼
 recipe steps (M₅ bytes)                    knowledge tables (M₄ / procedures)
      │
      └── memory_id ──► workflow semantic row (counted once in C_addr)
```

---

## Pairing rules

### Create (pin)

1. A **non-auto** workspace capture calls `pinMemoryForWorkspaceCheckpoint` (`host/checkpoints/manager/create.ts`). That pins a brain snapshot **and** upserts an episodic pointer leaf (id, label, session, files, recipe ids). Auto captures (`messageId` starts with `auto-`) stay file-only; restore may use `findNearestCheckpointBefore`.
2. Pin is best-effort. A failed brain pin must not fail the file snapshot. A failed leaf write must not fail the file snapshot.
3. `BrainManager.pinForWorkspaceCheckpoint` is idempotent per workspace id (same brain row if already linked). Tests: `memory-checkpoint.test.ts`.
4. Compaction may pin both ids (`pinCompactionSoul`) so a compacted chat still names the last workspace CP.
5. Contract **KN-316**: create pins a brain snapshot; restore can be files-only or files+memory.

### Restore (rewind)

1. File restore is always the workspace tool / UI. `rewind_memory=true` (or the UI equivalent) then calls `rewindMemoryForWorkspaceCheckpoint`.
2. Lookup: `findCheckpointByWorkspaceId`, else `findNearestCheckpointBefore(createdAt)` for older file CPs that were never paired.
3. Brain rollback replaces knowledge tables from the snapshot (`rollbackCheckpoint`). Then `trimEpisodicAfter(sessionId, createdAt)` drops later episodic turns. Working memory is cleared. `MemorySnapshot.invalidateAll()`.
4. `notifyCheckpointRestored` writes a soul event `kind: "restore"` with `workspaceCheckpointId` and `memoryCheckpointId`. That is the citation, **not** the snapshot JSON.
5. Files-only restore leaves semantic memory in place (`rewound` may still be true if episodic was trimmed).
6. Do **not** inject snapshot JSON, blob trees, or worktree contents into the prompt. Inject a pointer (`checkpoint_id=…`) when retrieval needs the turn (MEM-38).

### Delete / GC

1. Deleting a workspace CP calls `deleteMemoryPinsForWorkspaceCheckpoint` (best-effort).
2. Brain lifecycle cleanup **must not** evict a snapshot that has `workspace_checkpoint_id` (`CheckpointManager.runLifecycleCleanup`).
3. Recipe blob pins (`registerRecipeBlobPins` / `recipeBlobPins.ts`) keep live-recipe `blob_hash`es off the workspace GC list (MC-12). Call at host init when recipes are on, and again on capture/replay (idempotent).
4. `max_bytes` on `brain.sqlite` is a disk valve. It is not a reason to treat checkpoints as `C_addr`.
5. `builtin_memory` delete / forget and TTL tombstone the leaf (row + FTS stay). Privacy wipe (`knox.memoryBrain.wipe`) tombstones first, then hard-deletes the live sqlite. Pinned rows are exempt from forget/TTL, not from wipe.

---

## Recipes (M₅) and checkpoints

Recipes store **hashes and checkpoint ids**, never file bytes (`recipes/README.md` rules 1–7). `sourceCheckpointIds` are derived from step `checkpoint_id`s.

- Replay takes a pre-replay workspace CP so one restore undoes the apply.
- A linked `workflow` semantic row (`linkRecipeMemory`) is the lexical handle. Count that row **or** the recipe title/intent in `C_addr` M₅, not both (MEM-09).
- Knowledge snapshot v3 (`collectKnowledgeSnapshot`) includes `brain_recipes`, `brain_recipe_steps`, `brain_memory_outcomes`, `brain_memory_supersessions`, `brain_attribution`, and `brain_summary_tree`. Rollback restores those tables. A verified recipe whose linked `memory_id` is missing after rewind is relinked (`linkRecipeMemory` + `memoryExists`). Recipe **bytes** stay in workspace checkpoint blobs — the snapshot stores hashes and ids only.

Recipes stay **off by default** (`knoxchat.recipes.enabled`).

---

## Tools (keep the split)

| Tool | May do | Must not do |
| --- | --- | --- |
| `builtin_memory` | store / recall / search / delete / pin / unpin / `build_context` / `attribute` | restore files, rollback brain snapshots, grow “context” by attaching checkpoint trees |
| `builtin_recipe` | list / preview / apply (confirm) / import skill | raw `fs` writes; apply without the replayer |
| `builtin_workspace_checkpoint` | disk graph (create, restore, stash, …); `rewind_memory` on restore | Memory Brain CRUD (that is `builtin_memory`) |

Product catalog already refuses admin brain actions on `builtin_memory`. Keep it that way.

---

## What “the agent knew” after rewind

Today a linked rewind restores snapshot v3 knowledge (including recipes, outcomes, supersessions, attribution, and the summary tree) + trims later episodic. It does **not** restore the in-memory soul ring.

MEM-38: workspace capture / pin upserts one episodic pointer leaf (`kind=checkpoint`) with id, label, session, file list, and recipe ids. Fusion retrieves that row through the existing lexical channels. Inject is `checkpoint_id=…` only — never snapshot JSON, blob trees, or worktree contents. Overview still does not count `|blobs|/rᵢ`.

- Treat a restore soul event as the episodic record of the rewind.
- Do not claim Overview “effective context” includes checkpoint blobs.
- Do not scan the checkpoint graph as a retrieval channel except via those pointer / soul / episodic rows.

---

## File map

| Concern | Path |
| --- | --- |
| Pin / rewind / soul | `core/context/soul/recordSoulEvent.ts` |
| Workspace create pin | `host/checkpoints/manager/create.ts` `shouldPinMemoryForWorkspaceCheckpoint` |
| Restore notify | `host/checkpoints/notifyRestore.ts` |
| Brain snapshot I/O | `core/context/memory/brain/store/checkpoints.ts` |
| Protect linked pins | `core/context/memory/brain/CheckpointManager.ts` `runLifecycleCleanup` |
| Recipe blob GC pins | `host/checkpoints/recipeBlobPins.ts` |
| Agent restore | `core/tools/implementations/workspaceCheckpoint.ts` (`rewind_memory`) |
| Tests | `brain/memory-checkpoint.test.ts`, KN-316 in `knoxMemoryContract.test.ts` |

---

## Invariants (testable)

1. **No second brain.** Workspace CP ≠ knowledge store. Brain CP ≠ file store. Neither is `C_addr` capacity.
2. **Best-effort pin.** File capture succeeds even if the brain is closed.
3. **Linked pins survive brain lifecycle GC.**
4. **Restore is explicit.** `rewind_memory` defaults off; the user (or confirm) opts in.
5. **Cite, do not dump.** A restore writes a soul `restore` event. The model sees a pointer or that episodic row, not snapshot JSON.
6. **Lexical only.** Pairing does not add embeddings or a vector index over checkpoints.
