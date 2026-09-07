import { streamLines } from "../../diff/util.js";
import { SlashCommand } from "../../index.js";
import { t } from "../../i18n/index.js";
import { removeQuotesAndEscapes } from "../../util/index.js";

function commandIsPotentiallyDangerous(command: string) {
  return (
    command.includes("rm -rf") ||
    command.includes("sudo") ||
    command.includes("cd / ")
  );
}

const GenerateTerminalCommand: SlashCommand = {
  name: "cmd",
  description: t("generateShellCommand"),
  run: async function* ({ ide, llm, input }) {
    if (input.trim() === "") {
      yield t("cmdEmptyInput");
      return;
    }

    const gen = llm.streamComplete(
      `The user has made a request to run a shell command. Their description of what it should do is:

        "${input}"

        Please write a shell command that will do what the user requested. Your output should consist of only the command itself, without any explanation or example output. Do not use any newlines. Only output the command that when inserted into the terminal will do precisely what was requested. Here is the command:`,
      new AbortController().signal,
    );

    const lines = streamLines(gen);
    let cmd = "";
    for await (const line of lines) {
      console.log(line);
      if (line.startsWith("```") && line.endsWith("```")) {
        cmd = line.split(" ").slice(1).join(" ").slice(0, -3);
        break;
      }

      if (
        line.startsWith(">") ||
        line.startsWith("``") ||
        line.startsWith("\\begin{") ||
        line.trim() === ""
      ) {
        continue;
      }

      cmd = removeQuotesAndEscapes(line.trim());
      break;
    }

    yield t("generatedShellCommand", { cmd });
    if (commandIsPotentiallyDangerous(cmd)) {
      yield t("dangerousCommandWarning");
    } else {
      await ide.runCommand(cmd);
    }
  },
};

export default GenerateTerminalCommand;
