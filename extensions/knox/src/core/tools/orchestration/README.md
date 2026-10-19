# Tool orchestration (library)

Helpers for opt-in tools (`builtin_enhanced_search`, `builtin_intelligent_chain`, composites). **Not the product path.**

| Path | Reality |
|------|---------|
| Default chat / agent tools | `allTools` → `callTool` only |
| `SmartToolRouter` / pipelines / transactions | Removed in K-037. Do not re-add. |
| Composites / advanced | `allAvailableTools`; each has a `callTool` case. Off the catalog unless `knoxchat.enableCompositeTools`. |

Add capabilities as explicit tools with implementations and tests. See `honestyGate.test.ts`.
