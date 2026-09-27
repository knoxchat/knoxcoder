import { SlashCommand } from "../../index.js";
import { t } from "../../i18n/index.js";

/**
 * Autonomous multi-step agent loop (IMP-24).
 * Execution is handled in the GUI `streamResponse` thunk before legacy slash dispatch.
 * This registration exists so `/autonomous` appears in the slash-command picker.
 */
const AutonomousSlashCommand: SlashCommand = {
  name: "autonomous",
  description: t("autonomousSlashCommand"),
  run: async function* () {
    yield t("autonomousSlashCommandUsage");
  },
};

export default AutonomousSlashCommand;
