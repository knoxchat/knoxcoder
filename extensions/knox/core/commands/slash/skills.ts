import { SlashCommand } from "../../index.js";
import { getSkillManager } from "../../tools/implementations/skillSingleton.js";

const SkillsSlashCommand: SlashCommand = {
  name: "skills",
  description: "List all loaded skills and their sources",
  run: async function* () {
    const manager = getSkillManager();
    if (!manager) {
      yield "No skills system initialized. Skills will be available once the skill manager loads.";
      return;
    }

    const skills = manager.all();
    const dirs = manager.dirs();

    if (skills.length === 0) {
      yield "No skills loaded.\n\nTo add skills, create `SKILL.md` files in:\n- `~/.knox/skills/` (global, Knox-native)\n- `skills/` or `skill/` in your workspace\n- `.claude/` or `.agents/` (external formats)\n- `.opencode/skill/` or `.opencode/skills/`\n\nOr configure additional paths in your Knox config under `skills.paths`.";
      return;
    }

    let output = `## Loaded Skills (${skills.length})\n\n`;

    for (const skill of skills) {
      const desc = skill.description ? ` - ${skill.description}` : "";
      const loc = skill.location ? `\n  - Source: \`${skill.location}\`` : "";
      output += `- **${skill.name}**${desc}${loc}\n`;
    }

    if (dirs.length > 0) {
      output += `\n### Scanned Directories (${dirs.length})\n\n`;
      for (const dir of dirs) {
        output += `- \`${dir}\`\n`;
      }
    }

    yield output;
  },
};

export default SkillsSlashCommand;
