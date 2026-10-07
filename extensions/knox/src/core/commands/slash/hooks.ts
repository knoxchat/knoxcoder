import { SlashCommand } from "../../index.js";
import { formatHookLogEntry, getHookLogEntries } from "../../hooks/auditLog.js";
import { HOOK_EVENTS } from "../../hooks/hooks.js";
import { getWorkspaceHookRunner } from "../../hooks/workspaceHooks.js";

const RECENT = 30;

const HooksSlashCommand: SlashCommand = {
  name: "hooks",
  description: "Show configured lifecycle hooks and the recent hook audit log",
  run: async function* ({ ide }) {
    const runner = await getWorkspaceHookRunner(ide, () => undefined);
    const lines: string[] = ["## Hooks", ""];
    const configured = runner
      ? HOOK_EVENTS.filter((e) => runner.has(e))
      : [];
    if (!configured.length) {
      lines.push(
        "No hooks configured. Add a `hooks:` block to `config.yaml` or `.knoxcoder/config.yaml`, or create `.knoxcoder/hooks.json`.",
      );
    } else {
      lines.push(`Active events: ${configured.join(", ")}`);
    }
    const entries = getHookLogEntries().slice(-RECENT);
    lines.push("", `## Audit log (last ${entries.length})`, "");
    if (!entries.length) {
      lines.push("No hook has run yet in this session.");
    } else {
      lines.push("```", ...entries.map(formatHookLogEntry), "```");
    }
    yield lines.join("\n");
  },
};

export default HooksSlashCommand;
