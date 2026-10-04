# Knox test policy

- No retry masking: `retry`/`--retry` is not allowed in vitest, mocha or CI steps. A flaky test is fixed or quarantined.
- Quarantine: a flaky test is skipped with `it.skip(...)` and a comment `// QUARANTINE(owner, #issue): reason`, and listed below.
  A quarantined test older than one release is deleted or fixed.
- Gate: Linux Knox CI (tsc, core, pkg, inventory) gates packaging. The Electron GUI job and the Windows/macOS
  workflow are advisory until three consecutive green runs, then they are made required.

## Quarantine list

| Test | Owner | Issue | Since |
| ---- | ----- | ----- | ----- |
| (none) | | | |
