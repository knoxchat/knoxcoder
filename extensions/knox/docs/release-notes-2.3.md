# Knox 2.3

Full detail is in `CHANGELOG.md`; upgrade steps in [upgrade.md](upgrade.md); caveats in [known-issues.md](known-issues.md).

## 2.3.2

- **Memory Brain Rev 2.** Write path, forgetting, calibration, erasure, and a release gate on the 2.3.0 rewrite. Retrieval stays local lexical (no embeddings). Overview shows `ε_Ω` and the five invariant chips.
- **tsrs typecheck.** Native TypeScript 7 CLI, gulp compile, and the layers checker run [tsrs](https://github.com/oxc-project/tsrs) instead of Go `tsc`.
- **Editor host VS Code 1.145.2.** Electron 43.8.3, without Copilot or telemetry. Knox Agent stays isolated from upstream AI.
- **Update Available popup.** Centered dialog with version, size, GitHub release notes, and Skip Version / Later / Download & Install.
- **Retrieve stays O(log N).** Graph, trigram, semantic, episodic, and ripgrep no longer `COUNT(*)` the store. Rec-vs-N gates growth on p50.

## 2.3.1

- **Title-bar History and Settings.** Conversation History and Settings sit with Memory and Checkpoint. Tools, Prompts, Rules, and Models live in the Settings sidebar; the composer stays a send row.
- **Composer chrome.** Hide-panel and transcript scroll sit between New chat and Auto. Gathering context is on the agent meter. Model and Send icons match the Memory brain size.
- **Send during a live turn or Ask User.** Send and Cancel stay on the composer while a turn streams. A generated question no longer looks like a live turn or blocks submit.
- **README.** Product brief for KnoxCoder and native Knox (no gallery / data-directory packaging note).

## 2.3.0

- **Memory Brain rewrite.** Stored memory is unbounded (`C_addr`); each model call is a bounded context (`C_use ≤ W` of the routed model). Success is measured recall, not a bigger inject number. Retrieval stays local lexical — no embeddings.
- Lossless store: archive + tombstone instead of DELETE; summaries are pointers; original `content` stays.
- Value / R tiers and FSRS on cited+helpful or harmful use only. Retrieve and inject do not raise stability.
- Four-channel RRF (lexical, ripgrep, graph, tree). Importance cannot resurrect `rel=0`.
- Inject against the routed window (`W_mem` after system, goal, recent turns, and output). Recipes and checkpoints count as Memory Brain leaves.
- Overview is stored-vs-window (`C_addr` vs `C_use / W`) with Rec / `H_0.85` / `σ` / `ε_*`. Disk default is 1 GiB.
- Chat recipe save/skip notices stay on Memory → Recipes.
- Rec-vs-N leftover scan and latency gates, Jev status bar matches the Settings toggle, and pinning an editor no longer trips ResizeObserver.

## Not in 2.3

MCP, vector embeddings, env API keys, and P4 extras (browser, headless CLI).

## Verification

SHA-256 sums for every asset are in `SHA256SUMS` on the Release page.
