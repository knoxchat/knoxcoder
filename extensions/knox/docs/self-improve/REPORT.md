<!-- Copyright (c) KnoxStudio. All rights reserved. Licensed under the GNU GPL-3.0 License. -->

# Self-improve report template

`npm run mc:self-improve` writes `docs/self-improve/<date>-self-improve.md`.
The dated file is a draft. This page is the section contract (MEM-43).

Self-improve reports the **Bounded-Context Recall Theorem**, not git-as-checkpoints.
`git log` churn is labeled **commit churn**. Workspace / brain checkpoints stay
rewind machinery (see `knox-memory-checkpoint.md`).

```
# Project health: <name>

Generated <iso>. Local only; nothing was sent anywhere.

## Theorem

- Rec vs N: N=1000 Rec=…; N=10000 Rec=…; N=100000 Rec=…
- σ …, ε_B …, ε_S …, theorem_held …
- false-inject: …
- attribution coverage: …% (k/n injects have an outcome)
- recipe wrongApplyRate: …

## Dependencies
## Flaky tests
## Hot files (commit churn)
## TODO / FIXME density
## Undocumented known issues
## Recipes
## Memory bench baseline
## Threshold tuning

### Retrieval θ (`retrieval.theta`)
### Channel weights w_s (`fusion.channelWeights`)
### Relevance gate score bar (`relevance.lexicalScoreMin`)
### Replay threshold (`recipes.replayThreshold`)

## Next steps
```

| Section | What it must show |
| --- | --- |
| Theorem | Rec vs N from the scale bench (or `not published`). `ε_S` (and σ / ε_B when a bench wrote them). Fixture `falseInjectRate`. Attribution coverage = injected rows with a helpful/unhelpful outcome, over injected rows. Recipe `wrongApplyRate`. |
| Hot files | `git log` paths, labeled **commit churn** / **commits**. Never “checkpoints”. |
| Recipes | Live M₅ counts plus `wrongApplyRate` when Memory Brain (or `--history`) supplied them. |
| Threshold tuning | `proposeThresholds` fits **θ** and **w_s** from `brain_attribution` / leftover outcomes that write that table. The lexical-gate sweep and replay threshold stay leftover tools. Nothing is applied until a maintainer approves. |

Pass `--brain ~/.knoxcoder/memory/brain.sqlite` (default) and optional `--history file.json` with `{ relevance, replays, attribution }`. Flat FTS (`ε_B = n/a — flat FTS`) is an honest miss, not a proof.
