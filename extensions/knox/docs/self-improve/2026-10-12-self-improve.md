# Project health: knox

Generated 2026-10-12T20:02:03.587Z. Local only; nothing was sent anywhere.

## Dependencies

- Runtime: 38, dev: 2
- Audit: not run (provide `npm audit --json` output to include it)

## Flaky tests

None seen across sessions.

## Hot files (most churn in checkpoints)

- `src/vs/workbench/contrib/knox/browser/knoxGuiWidget.test.ts`: 26 checkpoints
- `src/vs/workbench/contrib/knox/common/knoxGuiParity.test.ts`: 22 checkpoints
- `extensions/knox/package.json`: 21 checkpoints
- `src/vs/workbench/contrib/knox/browser/gui/widget/chrome.ts`: 19 checkpoints
- `src/vs/workbench/contrib/knox/browser/knoxGuiController.test.ts`: 18 checkpoints
- `src/vs/workbench/contrib/knox/browser/media/knoxGuiComposer.css`: 18 checkpoints
- `src/vs/workbench/contrib/knox/common/knoxGuiState.ts`: 18 checkpoints
- `src/vs/workbench/contrib/knox/common/knoxAgentHostContract.test.ts`: 17 checkpoints
- `src/vs/workbench/contrib/knox/browser/media/knoxGui.css`: 16 checkpoints
- `src/vs/workbench/contrib/knox/browser/gui/knoxGuiWidget.ts`: 15 checkpoints

## TODO / FIXME density

- 55 TODO, 20 FIXME in 1650 files (0.3 per 1000 lines)
- `extensions/knox/src/core/edit/assist/editAssist.ts`: 7 TODO, 1 FIXME
- `extensions/knox/src/core/edit/assist/editAssist.test.ts`: 6 TODO, 1 FIXME
- `extensions/knox/src/core/context/memory/selfImprove/healthReport.ts`: 3 TODO, 3 FIXME
- `extensions/knox/src/core/context/memory/selfImprove/healthReport.test.ts`: 3 TODO, 2 FIXME
- `extensions/knox/src/core/context/memory/selfImprove/selfAnalysis.test.ts`: 2 TODO, 2 FIXME

## Undocumented known issues

Every observed issue is covered by `docs/known-issues.md`.

## Memory bench baseline

- recallAtK 1, precision 0.625, falseInjectRate 0, tokensMean 166

## Threshold tuning

No recorded history was supplied, so no threshold proposal was made. Pass `--history <file.json>` with `{ relevance, replays }` samples.

## Next steps

- Read the hot files and flaky tests above; open issues by hand if they are real.
- Nothing in this file was sent anywhere.
