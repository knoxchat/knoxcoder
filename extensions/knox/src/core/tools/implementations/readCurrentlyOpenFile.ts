import { getUriDescription } from "../../util/uri";

import { ToolImpl } from ".";
import { toolEditor, toolFilesystem } from "../toolPorts";

export const readCurrentlyOpenFileImpl: ToolImpl = async (args, extras) => {
  const result = await toolEditor(extras).getCurrentFile?.();

  if (!result) {
    return [];
  }

  const { relativePathOrBasename, last2Parts, baseName } = getUriDescription(
    result.path,
    await toolFilesystem(extras).getWorkspaceDirs(),
  );

  return [
    {
      name: `Active file: ${baseName}`,
      description: last2Parts,
      content: `\`\`\`${relativePathOrBasename}\n${result.contents}\n\`\`\``,
      uri: {
        type: "file",
        value: result.path,
      },
    },
  ];
};
