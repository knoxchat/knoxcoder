# Knox 2.3

Full detail is in `CHANGELOG.md`; upgrade steps in [upgrade.md](upgrade.md); caveats in [known-issues.md](known-issues.md).

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
