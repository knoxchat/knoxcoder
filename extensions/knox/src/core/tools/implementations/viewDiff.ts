import { ToolImpl } from ".";
import { toolGit } from "../toolPorts";

export const viewDiffImpl: ToolImpl = async (args, extras) => {
  const diff = await toolGit(extras).getDiff(true);
  return [
    {
      name: "Git Diff",
      description: "Current Git Diff",
      content: diff.join("\n"),
    },
  ];
};
