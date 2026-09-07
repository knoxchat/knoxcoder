# Custom tools and skills

How to extend Knox Agent without claiming unused orchestration libraries.

## Default vs opt-in

| List | Meaning |
|------|---------|
| `allTools` | Default Agent chat tools. Every entry **must** have a `callTool` case + tests. |
| `allAvailableTools` | `allTools` + opt-in advanced/composites. Same honesty rule. |
| `unimplementedAdvancedTools` | Definitions only — **not** exposed. Do not document as shipped. |

`SmartToolRouter` is experimental and **not** exported. Do not add new product features there.

## PR honesty checklist

Same gate as `.github/pull_request_template.md` and `core/eval/honestyGate.test.ts`:

- No new tool definition without a `callTool` route **and** tests
- Do not put a def on `allTools` / `allAvailableTools` until it is implemented
- Do not document `SmartToolRouter` as the default chat path (default is `allTools` → `callTool`)
- Unimplemented defs stay in `unimplementedAdvancedTools`

## Add a built-in tool

1. Add a name to `BuiltInToolNames` in `builtIn.ts`.
2. Definition in `definitions/<name>.ts` (description must match real behavior).
3. Implementation in `implementations/<name>.ts` + a test file.
4. Route it in `callTool.ts` (`routeBuiltInTool`).
5. Append the definition to `allTools` in `index.ts`.
6. i18n strings in `core/i18n/locales/{en,zh}/tools.json`.
7. Permission default in `gui/src/redux/util/toolPermissionDefaults.ts` (read vs ask).

## HTTP / URI custom tools

`callToolFromUri` in `callTool.ts` POSTs `{ arguments }` to an `http:` / `https:` tool URI and expects `{ output: ContextItem[] }`.

A `Tool` with `uri` set is executed if it is already on `config.tools`. YAML load does **not** register HTTP tools today — you must add them in code or via a config hook. Unknown protocols throw `INVALID_URI`.

## Skills (`builtin_skill`)

Skills are discovered at stream time. The tool description is rewritten with an `<available_skills>` list (names only). Calling `builtin_skill` with `{ name }` loads the skill body into a `<skill_content>` block — Claude/OpenCode-style: **names first, body on demand**.

Add a skill via the existing skill folders / skill manager; do not paste full skill text into the system prompt.
