/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable */

export const knoxGuiStringsEnSettings: Record<string, unknown> = {
	"interfaceSettings": "Interface Settings",
	"showSessionTabs": "Show Session Tabs",
	"codeBlockAutoWrap": "Code Block Auto-wrap",
	"showChatScrollbar": "Show Chat Scrollbar",
	"autoNameSessionTitles": "Auto-name Session Titles",
	"markdownFormatting": "Markdown Formatting",
	"accessibilityDisplay": "Accessibility & Display",
	"fontSize": "Font Size",
	"agentSettings": "Agent Settings",
	"agentProfile": "Agent profile",
	"agentProfileHint": "Default uses LSP verify with unlimited tool rounds. Rust: cargo check. Systems: make. Auto picks rust on Cargo.toml or systems on kernel/QEMU. Stop a run with Cancel.",
	"agentProfileDefault": "Default",
	"agentProfileRust": "Rust",
	"agentProfileSystems": "Systems",
	"agentProfileAuto": "Auto",
	"agentMaxSteps": "Max tool rounds per turn",
	"agentMaxStepsHint": "After this many tool rounds, Agent summarizes without more tools. Default 0 (unlimited) for every profile. Set a positive number to cap.",
	"agentDoomLoopThreshold": "Repeated-tool stop",
	"agentDoomLoopThresholdHint": "Stop after this many identical tool calls or consecutive failures and summarize. Default 3 (rust: 4, systems: 5). Set 0 to disable.",
	"agentViewSubdirectoryMaxFiles": "Directory listing max files",
	"agentViewSubdirectoryMaxFilesHint": "Default cap for View Subdirectory when the model does not pass maxFiles. Raise this for large repos. Default 1000.",
	"agentPolicyHint": "Path and command allow/ask/deny rules live in the Tools permissions panel. Project AGENTS.md can add always / ask / never blocks.",
	"defaultParameterSettings": "Default Parameter Settings",
	"defaultMaxTokens": "Default Max Tokens",
	"defaultTemperature": "Default Temperature",
	"auto": "Auto",
	"enabled": "Enabled",
	"disabled": "Disabled",
	"examplePattern": "Example: *.md, test/*",
	"applyChanges": "Apply Changes",
	"discardChanges": "Discard Changes",
	"noChangesToReview": "No changes to review",
	"jevEnabled": "Jev harness judgments",
	"jevEnabledHint": "System One judgments for Chat vs Agent routing, skill hints, context/tool gates, and citation checks. Uses your signed-in Knox Chat or OpenRouter account. Fail-open to current heuristics. When off, Agent mode is always used.",
	"recipeSettings": "Reuse verified work (experimental)",
	"recipesEnabled": "Remember verified work",
	"recipesEnabledHint": "When a build or test passes after Knox edits files, keep that work as a local recipe. Recipes stay on this computer unless you share a checkpoint bundle.",
	"recipesAutoReplay": "Reuse a recipe on a repeat task",
	"recipesAutoReplayHint": "Off: only suggest it to the model. Ask: show the exact changes and wait for you. Automatic: apply it without a model call. Every reuse is checked afterwards and undone if the check fails.",
	"recipesAutoReplay_off": "Off",
	"recipesAutoReplay_ask": "Ask me first",
	"recipesAutoReplay_exact": "Automatic",
	"selfImproveEnabled": "Let Knox review its own history",
	"selfImproveEnabledHint": "Knox looks for repeated failures and reverts in its memory and checkpoints and proposes fixes. Nothing changes or is posted anywhere without your approval."
};
