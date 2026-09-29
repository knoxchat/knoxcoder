## Summary

<!-- What changed and why. -->

## Agent honesty checklist

- [ ] Every tool in `allTools` / `allAvailableTools` is routed through `callTool` and has a real implementation.
- [ ] No claim that `SmartToolRouter` (or any smart-routing layer) is the default chat path; it is not exported from the public orchestration surface.
- [ ] Quarantined advanced tool definitions are not added to `allTools` / `allAvailableTools`.
- [ ] Docs describe what the code actually does (no aspirational features presented as shipped).
- [ ] Eval goldens use the scripted model (`createScriptedLlm`); no live LLM calls in CI.

## Testing

- [ ] Added or updated a test for the change (`cd extensions/knox/src/core && npx vitest run`).
- [ ] For Rust changes: `eval/rustTasks.test.ts` and `context/rustDefaults.test.ts` pass.
