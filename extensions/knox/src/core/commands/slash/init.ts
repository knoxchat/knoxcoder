import { SlashCommand } from "../../index.js";
import { buildAgentsMd } from "../../config/agentsMd.js";
import { loadCodebaseCard } from "../../context/codebaseCard.js";
import { joinPathsToUri } from "../../util/uri.js";

const FILE_TYPE_DIRECTORY = 2;

const InitSlashCommand: SlashCommand = {
  name: "init",
  description: "Create AGENTS.md from this repository (use --force to overwrite)",
  run: async function* ({ ide, input }) {
    const roots = await ide.getWorkspaceDirs();
    const root = roots[0];
    if (!root) {
      yield "No workspace directory found.";
      return;
    }

    const target = joinPathsToUri(root, "AGENTS.md");
    const force = /(^|\s)--force\b/.test(input ?? "");
    if (!force && (await ide.fileExists(target).catch(() => false))) {
      yield "AGENTS.md already exists. Run `/init --force` to replace it, or edit it directly.";
      return;
    }

    const entries = await ide.listDir(root).catch(() => [] as [string, number][]);
    const names = entries.map(([n]) => n);
    const readIf = async (file: string) =>
      names.includes(file)
        ? await ide.readFile(joinPathsToUri(root, file)).catch(() => undefined)
        : undefined;

    const content = buildAgentsMd({
      projectName: decodeURIComponent(root.replace(/\/+$/, "").split("/").pop() ?? "project"),
      entries: names,
      topDirs: entries.filter(([, t]) => t === FILE_TYPE_DIRECTORY).map(([n]) => n),
      packageJson: await readIf("package.json"),
      pyproject: await readIf("pyproject.toml"),
      codebaseCard: await loadCodebaseCard(ide).catch(() => ""),
      hasTests: names.some((n) => /^(tests?|__tests__|spec)$/.test(n)),
    });

    await ide.writeFile(target, content);
    yield `Created \`AGENTS.md\` (${content.split("\n").length} lines). Review it and fill in the TODO items.`;
  },
};

export default InitSlashCommand;
