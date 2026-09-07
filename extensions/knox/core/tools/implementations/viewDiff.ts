import { ToolImpl } from ".";

export const viewDiffImpl: ToolImpl = async (args, extras) => {
  const diff = await extras.ide.getDiff(true);
  return [
    {
      name: "Git Diff",
      description: "Current Git Diff",
      content: diff.join("\n"),
    },
  ];
};
