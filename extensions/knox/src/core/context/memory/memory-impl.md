# Knox Memory System — Phase 2 Implementation Roadmap

> **Focus:** Retrieval precision. The Memory Brain already stores, injects, and forgets. The remaining failure mode is **mismatch**: after multiple tasks in one session, or after the user continues with a different question, injected items belong to the *previous* topic.
>
> **Scope:** Local-only (`~/.knox/memory/brain.sqlite`). No vector stores, no remote memory APIs.
>
> **How to use this file:** Implement **one REL task per pass**, in the order at the bottom. Check the box only when acceptance criteria pass (tests + a manual chat check).

**Last analyzed:** 2026-09-06  
**In progress:** Sprint D remaining items implemented (REL-14/19/20 automated). REL-18 human IDE click-through still open.  
**Primary code paths:** `core/context/memory/brain/`, `gui/src/redux/thunks/streamResponse.ts`, `extensions/vscode/src/extension/VsCodeMessenger.ts`

**Phase 1 (IMP-01–IMP-28):** Complete. Spec alignment (hierarchy, pipeline, fusion, graph cap, C_effective, modes, project scope) is production-wired. Do not reopen those tasks unless a REL item explicitly depends on them.

---

## Diagnosis: Why Mismatch Happens

Mismatch is not one bug. It is several independent leaks that **compound** on follow-up turns.

### Failure scenario (the one users feel)

1. Session works on **Task A** (auth, for example). Extraction writes facts, entities, WM slots, and a session summary. Recency + importance are high.
2. User says **"ok, now fix the README"** or **"continue"** or **"what about X instead?"**.
3. Retrieval query is **only the current message**. Short / anaphoric / stopword-heavy queries match almost anything via FTS5 `term*` OR-matching.
4. BM25 scores are **min-max normalized per query**, so the least-bad of a bad candidate set becomes `1.0` and easily clears `θ = 0.6`.
5. Conversational fusion weights give recency `0.30` + importance `0.20`. A *recent Task A memory with zero real overlap* can still score near threshold.
6. Working memory still holds Task A (attention decay is `−0.05`, floor `0.1`). Session summary and pinned items are injected **with no query gate**. C_goal is the raw current message **and** a process-global prefrontal goal that Hippocampus/Amygdala overwrite with the last extracted title.
7. φ₆ fusion results are **thrown away**. φ₈ `ContextBuilder` searches again (semantic via fusion *plus* LIKE fallback; episodic via LIKE only; graph/procedures/patterns with **no θ**).
8. Wrong items get `retrieval_count++`, so they rank even higher next turn.

Topic detection already exists (`AutoMemory.detectTopicShift` → `brain_session_topics`) and is used at write (`topic_id`) and read (fusion boost / penalty) as of REL-05 / REL-06.

```
Turn N (Task A)          Turn N+1 (Task B or "continue")
───────────────          ────────────────────────────────
extract → semantic A     query = current message only
WM slots = A             WM still A (weak attendTo decay)
goal = A title           goal = stale process-global OR full B text
session summary = A      summary injected anyway
FTS5 OR prefix           stopwords match everything
BM25 min-max → 1.0       θ=0.6 passes garbage
graph LIKE %config%      common entities leak
retrieval_count++        mismatch reinforces itself
```

---

## Root Causes (by layer)

### 1. Query is too weak for follow-ups

| Where | What happens |
|-------|----------------|
| `streamResponse.ts` `buildMemoryGoal` | C_goal = truncated raw user text (duplicates the query; no task identity). |
| `NeuralArchitecture.processPreTurn` | Retrieval query = current `encodedMessage` only. No last-substantial-turn, no active topic keywords. |
| `RetrievalFusion.buildFts5Query` | Every token ≥ 2 chars becomes `term*` OR'd together. No stopword list. `"ok now do it"` → `ok* OR now* OR do* OR it*`. |
| `EnhancedSemantic.expandQuerySynonyms` | Substring match (`tok.includes(term)`). `"memory"` expands to recall/retrieval/context. Off by default, still a landmine. |

**Short / continuation phrases that currently retrieve noise:** `continue`, `ok`, `yes`, `now do X`, `and that`, `what about the other one`, `same for Y`.

### 2. Scores are not comparable to θ

| Where | What happens |
|-------|----------------|
| `RetrievalFusion.fts5SearchSemantic/Episodic` | Per-result-set min-max: `(score - min) / (max - min)`. The worst hit in a weak set still spans 0–1. |
| `detectFusionWeights` | Messages > 200 chars used **conversational** weights: recency `0.30` + importance `0.20` (lexical only `0.25`). REL-09: recency `0.15`, fts5 `0.40`; continuation has its own profile. |
| Default θ | `retrieval_threshold = 0.6`. Recency+importance alone can get a recent important memory to `~0.5` with **zero overlap**; any leaked FTS5/trigram/graph bump clears 0.6. |
| Provenance | `ContextBuilder` records `score: mem.importance_score`, **not** fusion score. UI cannot show "why this matched". |

### 3. Assembly ignores φ₆ and mixes ungated channels

| Channel | Gate? | File |
|---------|-------|------|
| φ₆ `Hippocampus.fusionRetrieve` | Has θ | `NeuralArchitecture.ts` — **result unused** |
| Semantic | Fusion θ, then LIKE fallback if empty | `ContextBuilder.buildSemanticContext` |
| Episodic | LIKE + `minImportance` only, **no fusion** | `buildEpisodicContext` |
| Graph / procedures / patterns | Keyword search, **no θ** | `buildGraphContext`, `buildProcedureContext`, `buildPatternContext` |
| Pinned semantic | Always first, **no query overlap** | `buildSemanticContext` |
| Session summary | Always if present | `buildDetailed` |
| Working memory | `attendTo` then **dump all remaining slots** | `WorkingMemory.buildContext` |

### 4. No task / topic isolation

| Mechanism | Status |
|-----------|--------|
| `brain_session_topics` | Written on shift. **Never read** by fusion, ContextBuilder, or WM. |
| `brain_semantic` schema | `source_session_id` only. **No `topic_id` / `task_id`.** |
| `PrefrontalCortex.currentGoal` | **Process-global** (not session-scoped). `feedbackFromHippocampus` overwrites with last extracted title. `feedbackFromAmygdala` can set goal to a random high-salience snippet. |
| Topic shift | Detected after 8 messages (too late). Does **not** flush WM, clear goal, or change retrieval bias. |

### 5. Working memory keeps the previous task

| Where | What happens |
|-------|----------------|
| `WorkingMemory.attendTo` | Match boost `+0.3`; mismatch decay **`−0.05`** with floor **`0.1`**. Evict below `0.15` — Task A survives many Task B turns. |
| TTL | 30s from `added_at`, **not** from last refresh. Session restore can rehydrate stale slots. |
| `Thalamus.attend` | Every high-salience message (≥0.55) is **added as a new WM slot** (`salient:${Date.now()}`). |
| `Brainstem.feedbackToThalamus` | Re-`attendTo`s **injected item titles**. Wrong injections re-boost themselves for the next turn. |

### 6. Extraction writes noisy, untagged, undeduped facts

| Where | What happens |
|-------|----------------|
| `AutoMemory.extract` | Calls `BrainStore.storeSemantic` **directly** — skips `BrainManager.store` dedup (`findDuplicates` / `boostDuplicate`). |
| Heuristics | `"we should"`, `"please always"`, `"this project"` fire on generic assistant prose. Code-pattern stores preceding sentence + fenced block. |
| `memory/postTurn` | Concatenates user + assistant + tool summary into one extraction blob. Mixed-task turns become one semantic row. |
| `llmPostActionMemory` | Extra write for turns > 400 chars — another untagged dump. |
| `SleepConsolidation.remDistill` | Keyword across sessions → `"Recurring pattern: ${keyword}"` with **no topic** and `source_session_id` null. |

### 7. Feedback loops lock in the error

- Wrong semantic hits used to increment `retrieval_count` + `last_accessed_at` (`RetrievalFusion.search` and `BrainStore.searchSemantic`). REL-12: fusion bumps only gated hits with score ≥ θ; LIKE no longer bumps the candidate list.
- `searchSemantic` ranks by `importance_score DESC, retrieval_count DESC, last_accessed_at DESC` before BM25 re-rank.
- Graph `LIKE %entityName%` on common names (`file`, `user`, `config`, `memory`) attaches unrelated memories.

---

## Design Principles (Phase 2)

1. **Lexical (or entity) evidence is required.** Recency and importance may *rank*, never *qualify* a miss.
2. **One retrieval, one assembly.** φ₆ output is the candidate set for φ₈. No second LIKE hunt unless fusion is empty.
3. **Current task is first-class.** Detect continuation vs topic shift. Tag writes. Bias reads. Flush WM on shift.
4. **Follow-up queries are expanded, not searched raw.** `"continue"` retrieves against the active topic + last substantial user turn.
5. **Mismatches must be able to die.** Negative UI feedback and no `retrieval_count` bump on weak hits.
6. **Stay local.** Rule-based / FTS5 / graph only. No embeddings.

---

## Implementation Tasks

Each task is self-contained. Do not start REL-N+1 until REL-N's checkboxes are done, except where the sprint plan says items can run in parallel.

---

### REL-01 — Query hygiene + follow-up expansion (P0)

**Goal:** Never search FTS5/LIKE with raw continuation text. Build a **retrieval query** distinct from the display C_goal.

**New file:** `core/context/memory/brain/RetrievalQuery.ts`

**Behavior:**
- Stopword list (shared with AutoMemory topic keywords): drop `the, a, an, is, ok, now, do, it, this, that, continue, please, yes, yeah, also, …`
- Detect **continuation** vs **new task**:
  - Continuation: `/^(continue|ok|okay|yes|yeah|and then|also|same for|do the same|keep going)\b/i`, or message < ~40 chars with no content nouns after stopword strip.
  - New task: imperative/question with content words, or Jaccard(keywords, active topic) < 0.35.
- **Expanded query** = content words from current message ∪ active topic keywords ∪ last substantial user message (from WM or last episodic user turn). Cap length.
- `buildFts5Query`: AND content words (prefix OK), OR only explicit synonym expansions. Never OR stopwords.

**Wire into:** `NeuralArchitecture.processPreTurn`, `Hippocampus.fusionRetrieve`, `ContextBuilder.buildDetailed` (pass `retrievalQuery` separately from `message` / `goal`).

**Status:** Implemented 2026-09-06 (automated tests green). Manual IDE check still open.

**Acceptance criteria:**
- [x] `"continue"` after an auth turn retrieves auth-related memories, not README/unrelated.
- [x] `"now update the README"` does **not** use `now*` as an FTS term.
- [x] Unit tests: stopword strip, continuation detect, expansion includes last substantial turn.
- [x] C_goal display text is unchanged (still the user's current ask).
- [ ] Manual IDE: continuation vs topic-switch in a real chat (REL-18 A–C).

---

### REL-02 — Absolute scores (kill per-query min-max) (P0)

**Goal:** Fusion scores comparable across queries so `θ` means something.

**Modify:** `RetrievalFusion.ts`

**Behavior:**
- Stop min-max stretching of BM25 within the current result set.
- Map raw BM25 with a bounded transform (e.g. `1 - exp(-raw)` or rank-sigmoid) **or** keep raw and set θ on a documented scale — pick one and document it in this file.
- Trigram Jaccard already in `[0,1]` — leave it.
- Recency already in `[0,1]`.
- **Hard cap:** `w_recency * recency + w_importance * importance` must not exceed `θ - 0.05` by itself. Lexical (`fts5 + trigram`) or graph must supply the rest.

**Status:** Implemented 2026-09-06 (automated tests green).

**Acceptance criteria:**
- [x] A high-importance memory with **zero** token overlap with the query scores `< θ`.
- [x] Two queries of different candidate-set sizes produce comparable scores for the same document.
- [x] Regression: existing fusion tests updated; no test asserts min-max `1.0` for the top of a weak set.

---

### REL-03 — Post-fusion mismatch gate (P0)

**Goal:** Drop candidates that have no evidence they belong to the current question.

**New helper:** `core/context/memory/brain/RelevanceGate.ts`  
**Modify:** `RetrievalFusion.search` (after score, before slice), `ContextBuilder` section builders.

**Gate (all must fail to drop; pinned may skip lexical but still needs a reason):**
1. Content-word overlap (title ∪ keywords ∪ first N chars of content) with retrieval query ≥ 1, **or**
2. Shared knowledge-graph entity with query entities, **or**
3. `fts5 + trigram ≥ 0.25` after REL-02 scaling.

**Provenance:** `InjectedMemoryItem.score` = fusion score. `reason` names the evidence (`"lexical: auth, oauth"`, `"entity: AuthService"`, `"pinned"`). Never importance alone.

**Status:** Implemented 2026-09-06 (automated tests green). Manual IDE check still open.

**Acceptance criteria:**
- [x] Task A memories fail the gate on a Task B query with disjoint keywords.
- [x] Pinned items still inject, with `reason` starting with `pinned`.
- [x] Injected Memories panel shows fusion score, not importance.

---

### REL-04 — Single retrieval path: φ₆ → φ₈ (P0)

**Goal:** Stop searching twice. Fusion hits are the semantic **and** episodic candidate lists for assembly.

**Modify:** `NeuralArchitecture.ts`, `Brainstem.ts`, `ContextBuilder.ts`, `Hippocampus.ts`

**Behavior:**
- `processPreTurn` passes `FusionResult[]` into `Brainstem.assemble`.
- `ContextBuilder.buildDetailed` accepts optional `fusionHits`.
  - Semantic/episodic sections consume those hits (already θ-filtered).
  - LIKE/`searchSemantic`/`searchEpisodic` run **only** if fusion returned none.
- Graph / procedures / patterns: apply a minimum match (Jaccard or gate from REL-03). Empty is valid.
- Do not mix fusion + LIKE in the same section.

**Status:** Implemented 2026-09-06 (automated tests green).

**Acceptance criteria:**
- [x] One fusion call per pre-turn (assert via test spy or audit `pipeline:retrieval` once).
- [x] Episodic injects use fusion scores, not raw LIKE ranking.
- [x] Graph/procedure/pattern items that fail the gate are omitted.

---

### REL-05 — Topic as a retrieval dimension (P0)

**Goal:** Use the topic system that already exists.

**Schema:** add `topic_id INTEGER NULL` on `brain_semantic` (and optionally `brain_episodic` metadata). Backfill null is OK.

**Modify:** `AutoMemory.extract` / `Hippocampus.encode`, `BrainStore.storeSemantic`, `RetrievalFusion.search`, `ContextBuilder.buildDetailed`

**Behavior:**
- On extract, attach `BrainStore.getLatestSessionTopic(sessionId)?.id` (or create a lightweight current-topic if none).
- On topic shift (`detectTopicShift`): emit event **and** call a new `onTopicShift(sessionId)` (see REL-06).
- Retrieval: if `memory_scope` is project **and** current topic exists, **boost** same-`topic_id` (additive, after gate) and **penalize** other topics in the same session. Do not hard-exclude other topics (user may refer back).
- Session summary: skip or compress if keyword overlap with retrieval query / current topic is below threshold (REL-10 can refine).

**Lower `TOPIC_WINDOW_SIZE`** from 8 toward 4, or run a cheap shift check every turn using Jaccard(current message keywords, current topic keywords).

**Status:** Implemented 2026-09-06 (automated tests green). Manual IDE check still open.

**Acceptance criteria:**
- [x] New semantic rows from a session with a topic have `topic_id` set.
- [x] After a detected shift, Task B query ranks Task B topic above Task A topic given equal lexical scores.
- [x] Topics still unused in GUI Session History remain browseable (no regression).
- [ ] Manual IDE: topic switch vs continuation (REL-18).

---

### REL-06 — Working memory isolation on topic shift (P0)

**Goal:** M₂ should not carry Task A into Task B.

**Modify:** `WorkingMemory.ts`, `Thalamus.ts`, `Brainstem.ts`, `NeuralArchitecture.ts`

**Behavior:**
- `attendTo`: mismatch decay stronger (e.g. `−0.25`), floor `0`. Evict below `0.2`.
- `buildContext`: inject only items with `relevance ≥ 0.35` **and** overlap with current retrieval query (or source `user` from this turn).
- `onTopicShift` / continuation=false: `WorkingMemory.clear()` (or evict all `relevance < 0.5`).
- `Thalamus.attend`: do not add a WM slot for the full user message every turn; add a **single** `current-turn` slot that replaces the previous one.
- `feedbackToThalamus`: only re-attend titles that pass REL-03. Never boost gated-out items.

**Status:** Implemented 2026-09-06 (automated tests green). Manual IDE check still open.

**Acceptance criteria:**
- [x] After a new-task message, WM context does not contain the previous task's salient slot.
- [x] Continuation (`"continue"`) **keeps** WM items for the active topic.
- [x] Tests for `attendTo` eviction and `buildContext` filtering.
- [ ] Manual IDE: topic shift WM chip gone (REL-18 D).

---

### REL-07 — Session-scoped goal; stop prefrontal overwrite (P1)

**Goal:** C_goal is the current user ask or an explicit plan — never the last extracted memory title.

**Modify:** `PrefrontalCortex.ts`, `NeuralArchitecture.ts`, `streamResponse.ts` `buildMemoryGoal`

**Behavior:**
- Store goal **per session id**, not a module-level singleton.
- Remove `feedbackFromHippocampus` goal overwrite (feedback may update a "recent knowledge" hint, not C_goal).
- `feedbackFromAmygdala` must not set C_goal.
- Clear goal on topic shift and on session switch.
- `buildMemoryGoal`: prefer Redux todo/plan title if present; else first line of user text (already truncated). Do not concatenate retrieval expansion into C_goal.

**Status:** Implemented 2026-09-06 (automated tests green). Manual IDE check still open.

**Acceptance criteria:**
- [x] Two concurrent sessions cannot clobber each other's goal.
- [x] After extraction of a fact titled `"Decision: use postgres"`, next user question `"how do I style the button?"` injects C_goal as the button question, not the postgres decision.
- [x] Tests for session-scoped get/set/clear.

---

### REL-08 — Extraction quality: dedup, task tag, less greedy heuristics (P1)

**Goal:** Fewer junk rows so retrieval has less to mismatch against.

**Modify:** `AutoMemory.ts`, `Hippocampus.encode`, `VsCodeMessenger` `memory/postTurn`

**Behavior:**
- All auto-extract stores go through `BrainManager.store` (or shared `storeSemanticDeduped`) so near-duplicates boost instead of insert.
- Tighten heuristics: require a content noun after `"we should"`; drop `"this project"` unless the sentence has a concrete claim; skip assistant filler (`Let me`, `I'll`, `Here's`).
- Post-turn: extract **user message** and **assistant message** separately (not one concatenated blob). Skip tool-summary unless it contains `error_fix` patterns.
- Attach `topic_id` (REL-05). Set `importance` lower (e.g. `0.45`) for heuristic hits vs explicit user `"remember that…"`.
- `llmPostActionMemory`: store only if LLM returns structured facts; skip if overlap with heuristic rows is high.

**Status:** Implemented 2026-09-06 (automated tests green).

**Acceptance criteria:**
- [x] Storing the same decision twice increments the existing row, does not insert a second.
- [x] A generic `"I'll update the file"` assistant line creates **zero** semantic rows.
- [x] A user `"We decided to use SQLite for the brain"` still extracts a decision.

---

### REL-09 — Fusion weight safety (P1)

**Goal:** Weight profiles cannot qualify a mismatch.

**Modify:** `memoryConfigAccess.ts` `detectFusionWeights`, defaults in `BrainStore.config`

**Behavior:**
- Continuation queries (REL-01) use a **continuation** profile: high recency **within** the gated set, still subject to REL-02 lexical floor.
- Lower conversational recency (e.g. `0.15`) and raise fts5 (e.g. `0.40`).
- Short factual queries: do not treat length < 80 as "boost importance".
- Document the five profiles and the continuation profile in Settings help text.

**Status:** Implemented 2026-09-06 (automated tests green).

**Acceptance criteria:**
- [x] Config defaults updated; GUI still loads.
- [x] Property: for every profile, `w_recency + w_importance < retrieval_threshold`.

---

### REL-10 — Gate pinned + session summary (P1)

**Goal:** Always-on sections should not drown the current question.

**Modify:** `ContextBuilder.ts`

**Behavior:**
- Pinned: keep always-on, but **cap** to `context_pinned_limit` and sort pinned-that-match-query first. If pinned count > 3 and none match, include at most 1–2 highest-importance pins + a one-line note that others were omitted.
- Session summary: inject only if overlap(summary keywords, retrieval query) ≥ threshold **or** mode is `full`. Otherwise skip (conversation history already has the thread).

**Status:** Implemented 2026-09-06 (automated tests green).

**Acceptance criteria:**
- [x] Unrelated pinned items do not fill the semantic budget before fusion hits.
- [x] After topic shift, a Task A session summary is omitted on a Task B query in `summarized` / `selective` modes.

---

### REL-11 — Graph / entity leakage (P1)

**Goal:** Common entity names must not LIKE-match the world.

**Modify:** `RetrievalFusion.graphExpansion`, `ContextBuilder.buildGraphContext`, `KnowledgeGraph.searchEntities` / `BrainStore.searchEntities`

**Behavior:**
- Do not graph-expand if query has no entity-like tokens (length ≥ 3, not stopword, or quoted identifier).
- Neighbor → memory join: require word-boundary / FTS match on entity **name**, not `LIKE %name%` for names shorter than 5 chars or in a common-noun denylist (`file`, `user`, `config`, `error`, `memory`, `test`, `data`).
- Cap graph contribution so it cannot lift a zero-lexical candidate over θ without REL-03 entity evidence.

**Status:** Implemented 2026-09-06 (automated tests green).

**Acceptance criteria:**
- [x] Query `"fix the login button"` does not inject memories that only matched entity `"file"`.
- [x] Query mentioning `AuthService` still expands that entity.

---

### REL-12 — Stop retrieval_count pollution (P1)

**Goal:** Wrong injects must not rank higher next time.

**Modify:** `RetrievalFusion.search`, `BrainStore.searchSemantic`

**Behavior:**
- Bump `retrieval_count` / `last_accessed_at` only if the item **passed REL-03** and fusion score ≥ θ.
- LIKE fallback path: bump only the items actually assembled into context, not the pre-rank candidate list.
- Optional: `mismatch_count` column incremented when user forgets/demotes (REL-14). Penalty in ranking: `score -= 0.15 * mismatch_count`.

**Status:** Implemented 2026-09-06 (automated tests green). `mismatch_count` is applied in REL-14.

**Acceptance criteria:**
- [x] Running a mismatched query 10 times does not increase `retrieval_count` on gated-out rows.
- [x] Items that were actually injected still increment.

---

### REL-13 — Explicit task identity (P2)

**Goal:** Multi-turn work has a `task_id` until shift or user starts a new question.

**New:** `core/context/memory/brain/TaskContext.ts`

**Behavior:**
- `task_id` = uuid, stored on session row or a small `brain_tasks` table (`id`, `session_id`, `topic_id`, `title`, `opened_at`, `closed_at`).
- Open on first substantial user message; close on topic shift / new-task detection (REL-01).
- Tag semantic writes with `task_id`.
- Retrieval boost: current task > current topic > same project > rest (multiplicative or additive, applied **after** the gate).

**Depends on:** REL-01, REL-05.

**Status:** Implemented 2026-09-06 (automated tests green).

**Acceptance criteria:**
- [x] Two sequential tasks in one session have two task rows; memories tagged accordingly.
- [x] `"continue"` stays on the open task; `"new question: …"` closes it.

---

### REL-14 — User mismatch feedback (P2)

**Goal:** Injected Memories panel can teach the ranker.

**Modify:** `InjectedMemoriesPanel.tsx`, `BrainStore`, protocol `memory/forget` or new `memory/mismatch`

**Behavior:**
- Existing forget/pin stay.
- Add **Not relevant** (demote): increment `mismatch_count`, optional tag `mismatch`, do not delete.
- Demoted items fail REL-03 for this session's current topic (or get a large penalty) for N days.
- Provenance shows evidence from REL-03.

**Status:** Implemented 2026-09-06 (automated tests green). Manual IDE check still open.

**Acceptance criteria:**
- [x] Clicking Not relevant on item X prevents X from injecting on the next turn of the same topic.
- [x] Pin still overrides demote if the user pins later.

---

### REL-15 — Sleep distill per topic (P2)

**Goal:** REM distillation must not merge unrelated sessions/topics into one insight.

**Modify:** `SleepConsolidation.ts` `remDistill`

**Behavior:**
- Cluster episodic by `topic_id` / session, not by a single global keyword.
- Distilled semantic rows get `topic_id` and `source_session_id`.
- Skip keywords in the common-noun denylist (REL-11).

**Status:** Implemented 2026-09-06 (automated tests green).

**Acceptance criteria:**
- [x] A keyword appearing in two unrelated topics does not create a single `"Recurring pattern: ${keyword}"` that concatenates both.

---

### REL-16 — Synonym expansion precision (P2)

**Goal:** Optional enhanced semantic must not explode the query.

**Modify:** `EnhancedSemantic.ts`

**Behavior:**
- Match whole tokens only (`tokens.includes(term)`), not `tok.includes(term)`.
- Expand at most one group; add at most 3 synonyms.
- Do not expand continuation queries.

**Status:** Implemented 2026-09-06 (automated tests green).

**Acceptance criteria:**
- [x] `"config"` may add `"settings"`; `"memory"` does not add `"context"` unless the token is exactly `memory`.
- [x] Tests for token-boundary matching.

---

### REL-17 — Regression suite: multi-task mismatch (P1)

**Goal:** The failure scenario is an automated test, not a vibe check.

**New/extend:** `core/context/memory/brain/memory-mismatch.test.ts`

**Cases (each builds a throwaway sqlite like existing brain tests):**
1. **Topic switch:** store semantic A (`oauth`, `jwt`); query `"update the README badges"` → no A titles in `items`.
2. **Continuation:** store A; query `"continue"` with expanded query → A still present.
3. **Stopwords:** query `"ok now do it"` does not FTS-match everything; either empty or expanded-from-topic.
4. **Min-max:** two weakly related docs; top score still `< θ` without overlap (REL-02).
5. **WM flush:** attend Task A, then new-task message → `buildContext()` omits A.
6. **Goal isolation:** extract then ask unrelated question → C_goal item title is the new question.
7. **Dedup:** extract same decision twice → one row.
8. **retrieval_count:** mismatched query does not bump gated-out ids.
9. **φ₆ once:** fusion search invoked once per `runPreTurn`.
10. **Pinned vs query:** 5 unrelated pins + 1 matching fact → matching fact in context; pins do not exhaust budget (REL-10).

**Status:** Sprint A cases 1–4 and 9 implemented 2026-09-06. Case 5 (WM flush) implemented with REL-06. Cases 6 and 10 implemented with REL-07 / REL-10. Case 7 implemented with REL-08. Case 8 implemented with REL-12.

**Acceptance criteria:**
- [x] `npx vitest run context/memory/brain/memory-mismatch.test.ts` green (cases 1–10).
- [x] Existing `memory-regressions` / `memory-pipeline` still green.

---

### REL-18 — Manual IDE checklist (mismatch) (P1)

**Goal:** Prove the chat path, not only unit tests.

**Status:** Pipeline A–C / E / F automated 2026-09-06. Remaining: IDE click-through for WM chip (D) and timeout banner (G).

- [x] Session: unique token `mismatch-alpha-aaa`. Next turn: `"what was mismatch-alpha-aaa?"` → panel shows that memory. *(pipeline test `REL-18 A`)*
- [x] Same session: `"now explain how git checkpoints work"` → panel does **not** list the alpha memory (unless pinned). *(pipeline test `REL-18 B`)*
- [x] `"continue"` immediately after the checkpoint question → checkpoint-related items, not alpha. *(pipeline test `REL-18 C`)*
- [ ] Topic shift after ~4–8 mixed turns: WM chip / working-memory item gone for the old topic. *(automated WM flush exists; confirm chip in the IDE)*
- [x] Pin the alpha memory, ask about checkpoints → alpha may appear as `[pinned]`, labeled as such. *(pipeline test `REL-18 E`)*
- [x] Forget / Not relevant (if REL-14 done) sticks across the next turn. *(pipeline test `REL-18 F`)*
- [ ] Timeout path still shows "Memory unavailable" and chat continues. *(timeout placeholder already wired in `streamResponse.ts`; confirm in the IDE)*

---

### REL-19 — Observability for mismatch (P2)

**Goal:** When it still fails, we can see why.

**Modify:** `MemoryPipeline` audit payload, optional `InjectedMemoryItem` fields

**Log per injected item (local audit, no network):**
`id, kind, fusion_score, fts5, trigram, graph, recency, importance, topic_id, task_id, gate_passed, retrieval_query`.

**GUI:** Injected Memories panel — show score + top evidence tokens; collapse items below 0.7 in `selective` mode.

**Status:** Implemented 2026-09-06 (automated tests green). Manual IDE check still open.

**Acceptance criteria:**
- [x] `brain/getAuditLog` after a turn contains `pipeline:output_generation` with item count and query used.
- [x] Panel reason is specific (`lexical: checkpoint`, not `"Matched current message (fact)"`).

---

### REL-20 — Config knobs for precision (P3)

**Goal:** Tune without code changes.

**New `MemoryConfig` keys (defaults conservative):**
| Key | Default | Purpose |
|-----|---------|---------|
| `retrieval_require_lexical` | `true` | REL-03 lexical/entity requirement |
| `retrieval_continuation_expand` | `true` | REL-01 expansion |
| `topic_shift_jaccard` | `0.35` | New-task vs continuation |
| `wm_mismatch_decay` | `0.25` | REL-06 |
| `wm_inject_min_relevance` | `0.35` | REL-06 |
| `summary_inject_min_overlap` | `0.2` | REL-10 |
| `pinned_unmatched_cap` | `2` | REL-10 |
| `fts5_use_and_for_content` | `true` | REL-01 |

Expose in Memory Settings (precision subsection). i18n keys required.

**Status:** Implemented 2026-09-06 (automated tests green).

**Acceptance criteria:**
- [x] Toggling `retrieval_require_lexical` false restores old "inject more" behavior for debugging.
- [x] Keys persist in `brain_config`.

---

## Recommended Implementation Order

### Sprint A — Stop the bleeding (do first, in order)

1. **REL-01** Query hygiene + follow-up expansion  
2. **REL-02** Absolute scores  
3. **REL-03** Mismatch gate  
4. **REL-04** φ₆ → φ₈ single path  
5. **REL-17** tests 1–4, 9 (write tests as you go; finish suite after A)

### Sprint B — Isolate tasks

6. **REL-06** Working memory isolation  
7. **REL-05** Topic dimension  
8. **REL-07** Session-scoped goal  
9. **REL-10** Pinned + summary gating  
10. **REL-17** tests 5–6, 10 + **REL-18** manual A–C

### Sprint C — Clean the store

11. **REL-08** Extraction quality  
12. **REL-09** Fusion weights *(done 2026-09-06; requested before REL-12)*  
13. **REL-12** retrieval_count *(done 2026-09-06)*  
14. **REL-11** Graph leakage *(done 2026-09-06)*  
15. **REL-17** tests 7–8

### Sprint D — Depth

16. **REL-13** Task identity *(done 2026-09-06)*  
17. **REL-14** Not-relevant feedback *(done 2026-09-06)*  
18. **REL-15** Sleep per topic *(done 2026-09-06)*  
19. **REL-16** Synonym precision *(done 2026-09-06)*  
20. **REL-19** Observability *(done 2026-09-06)*  
21. **REL-20** Config knobs *(done 2026-09-06)*  
22. **REL-18** remaining manual checks *(pipeline A–C/E/F automated; IDE D/G still open)*

---

## Architecture (precision path)

```
User message
    │
    ├─► RetrievalQuery.expand(message, topic, lastTurn)     REL-01
    │         retrievalQuery ──► φ₆ Hippocampus.fusionRetrieve
    │                                │
    │                                ├ BM25 (absolute)      REL-02
    │                                ├ trigram / graph
    │                                └ RelevanceGate        REL-03
    │
    ├─► C_goal = current ask | plan (session-scoped)        REL-07
    │
    ├─► topic/task boost (after gate)                       REL-05, REL-13
    │
    └─► φ₈ ContextBuilder(fusionHits)                       REL-04
              ├ semantic/episodic from hits only
              ├ graph/proc/pattern gated
              ├ pinned/summary gated                        REL-10
              └ WM filtered + flushed on shift              REL-06
```

Writes: `Hippocampus.encode` → deduped store + `topic_id`/`task_id` (REL-08, REL-05, REL-13).

---

## Phase 1 archive (do not re-implement)

IMP-01 Pipeline · IMP-02 Regions · IMP-03 Sensory buffer · IMP-04 Compression ratios · IMP-05 Working memory spec · IMP-06 Sleep cycle · IMP-08 Ebbinghaus · IMP-09 θ and top-k · IMP-11 Graph cap · IMP-12 Enhanced semantic (optional) · IMP-13 C_goal · IMP-14 Context window · IMP-15 Compress-oldest · IMP-16 C_effective dashboard · IMP-17 TaskRouter · IMP-18 Session ID · IMP-19 Memory modes · IMP-20 Preferences · IMP-21 Extraction polish · IMP-22 Session history · IMP-24 Autonomous loop · IMP-25 Project scope · IMP-26 GUI · IMP-27 Protocol · IMP-28 Tests.

Those remain the local Knox-MS behavior layer. Phase 2 sits **on top** of them.

---

## References

- Retrieval: `core/context/memory/brain/RetrievalFusion.ts`
- Assembly: `core/context/memory/brain/ContextBuilder.ts`
- Pre-turn: `core/context/memory/brain/regions/NeuralArchitecture.ts`
- Extraction: `core/context/memory/brain/AutoMemory.ts`
- Topics (read + write): `AutoMemory.detectTopicShift`, `BrainStore.getSessionTopics`, `brain_semantic.topic_id`
- Goal singleton: `core/context/memory/brain/regions/PrefrontalCortex.ts`
- Chat inject: `gui/src/redux/thunks/streamResponse.ts`
- Post-turn write: `extensions/vscode/src/extension/VsCodeMessenger.ts` (`memory/postTurn`)
- Storage: `~/.knox/memory/brain.sqlite`
