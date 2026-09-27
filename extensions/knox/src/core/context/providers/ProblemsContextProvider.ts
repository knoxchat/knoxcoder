import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
} from "../../index.js";
import { t } from "../../i18n/index.js";
import { getUriDescription } from "../../util/uri.js";
import { BaseContextProvider } from "../index.js";

class ProblemsContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "problems",
    displayTitle: "Problems",
    description: t("problemsInOpenedFiles"),
    type: "normal",
  };

  async getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    const ide = extras.ide;
    const problems = await ide.getProblems();
    const workspaceDirs = await ide.getWorkspaceDirs();

    const items = await Promise.all(
      problems.map(async (problem) => {
        const { relativePathOrBasename, baseName } = getUriDescription(
          problem.filepath,
          workspaceDirs,
        );
        const content = await ide.readFile(problem.filepath);
        const lines = content.split("\n");
        const rangeContent = lines
          .slice(
            Math.max(0, problem.range.start.line - 2),
            problem.range.end.line + 2,
          )
          .join("\n");

        return {
          description: t("problemInOpenedFile"),
          content: `\`\`\`${relativePathOrBasename}\n${rangeContent}\n\`\`\`\n${problem.message}\n\n`,
          name: t("warningIn", { file: baseName }),
        };
      }),
    );

    return items.length === 0
      ? [
          {
            description: t("problemInOpenedFile"),
            content: t("noProblemsFoundInFiles"),
            name: t("noProblemsFound"),
          },
        ]
      : items;
  }
}

export default ProblemsContextProvider;
