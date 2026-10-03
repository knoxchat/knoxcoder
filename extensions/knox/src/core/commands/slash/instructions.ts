import { SlashCommand } from "../../index.js";
import { collectActivePaths, discoverRules } from "../../config/rules.js";
import {
  buildInstructionReport,
  formatInstructionReport,
} from "../../config/instructionReport.js";
import { getSkillManager } from "../../tools/implementations/skillSingleton.js";

const InstructionsSlashCommand: SlashCommand = {
  name: "instructions",
  description: "Show loaded rules, AGENTS.md files and skills with their token cost",
  run: async function* ({ ide }) {
    const rules = await discoverRules(ide);
    const activePaths = await collectActivePaths(ide);
    const manager = getSkillManager();
    const report = buildInstructionReport({
      rules,
      skills: manager?.isLoaded ? manager.all() : [],
      activePaths,
    });
    yield formatInstructionReport(report);
  },
};

export default InstructionsSlashCommand;
