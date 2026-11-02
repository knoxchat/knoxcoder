# KnoxCoder

KnoxCoder is an enterprise code editor built on [Visual Studio Code](https://code.visualstudio.com) open source. It keeps the workbench, languages, debugger, terminal, Git, and extension host that teams already know, and it treats the coding agent as infrastructure: a native system component with on-device memory, reversible checkpoints, and organization-defined policy.

Visual Studio Code solved the editor. It did not solve governed autonomy. Upstream AI — Copilot, Chat, Agents, Agent Host, MCP — is a cloud product attached to the workbench: updated and observed by Microsoft, organized around a conversation, and silent on two problems every agent deployment hits. What should the system remember after the chat ends? How do you rewind a change the agent made without rewriting Git history? KnoxCoder is that editor, rebuilt around those two problems.

The editing surface stays familiar. The product around it does not. Knox ships as a first-class system component, the same class as Git — not a marketplace install. Memory Brain stores facts and decisions on the workstation and retrieves them locally (lexical search; no embeddings, no vector cloud). Checkpoints capture the tree before every file-changing turn and can restore files together with the knowledge that belonged to that turn. Tool policy, permission modes, hooks, skills, custom subagents, and team bundles encode how work is allowed to run. Model traffic goes only to the provider you configure. KnoxCoder does not adopt the upstream Copilot / chat / agent-host stack, does not send Microsoft telemetry or crash reports, and updates from KnoxCoder GitHub releases.

| | Visual Studio Code | KnoxCoder |
|---|---|---|
| Editor, languages, debug, terminal, Git | Yes | Same open-source lineage |
| AI | Copilot, Chat, Agent Host, MCP | Native Knox agent (those upstream surfaces are not adopted) |
| Long-term memory | Conversation / cloud Copilot | On-device Memory Brain |
| Agent edit history | Undo and Git | Git-independent checkpoints, pairable with memory rewind |
| Governance | Settings | Permission modes, tool policy, hooks, skills, subagents, team bundles |
| Telemetry and updates | Microsoft | Neither Microsoft telemetry nor crash reporter; KnoxCoder releases |
| License | MIT | GPL-3.0 (upstream VS Code files remain MIT) |

https://github.com/user-attachments/assets/271ed16b-66a2-4eee-a88d-afa4565a2d85

## Knox

Knox is KnoxCoder’s native coding agent — a first-class system component, the same class as Git. It ships with the editor and is available on first launch. It can be disabled; it cannot be uninstalled or replaced from a marketplace.

Knox is an enterprise coding environment: a policy-governed agent, durable on-device memory, and a reversible history of every change the agent makes.

- **Agent.** Plans, reviews, and executes multi-file work under Ask, Edits, or Auto permission, with Plan mode for design-before-execution. Destructive operations remain policy-gated in every mode. Organizations encode standards through project instructions, rules, skills, hooks, and custom subagents. Team bundles, background jobs, and review-before-apply support governed delivery.
- **Memory Brain.** On-device long-term memory for facts, decisions, and session context. Retrieval is local and lexical — no embeddings, no vector database, no cloud index. Stored memory is unbounded and addressable; each model call stays inside a bounded context window. Operators can inspect, pin, export, or wipe memory, and disable it per user or workspace.
- **Checkpoints.** A git-independent history captured automatically before every file-changing turn. Restore any turn, stash dirty work, cherry-pick or revert a change, continue through merge conflicts, blame a line back to the turn that introduced it, materialize an isolated worktree, bisect a regression, or export a portable patch. File snapshots can pair with Memory Brain so a rewind restores both the tree and the knowledge that belonged to that turn.
- **Recipes.** Optional and off by default. When enabled, Knox records verified file-changing work as reusable procedures, linked to the checkpoints that produced them, and can replay or adapt that work on a later match.

Session share stays local; Knox does not upload transcripts. Knox itself emits no product telemetry.

## Documentation

* [What is KnoxCoder](extensions/knox/docs/README.md)
* [Privacy](extensions/knox/docs/privacy.md)
* [Network](extensions/knox/docs/network.md)
* [Security / threat model](extensions/knox/docs/security/threat-model.md)
* [Release / update](extensions/knox/docs/release.md)
* [How to Contribute](https://github.com/knoxchat/knoxcoder)

## License

Copyright (c) KnoxStudio.

KnoxCoder is licensed under the [GNU GPL-3.0](LICENSE.txt). This repository includes Visual Studio Code source from Microsoft, which remains available under [MIT](LICENSE.vscode.txt).
