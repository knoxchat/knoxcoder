import generateRepoMap from "../../util/generateRepoMap";

import { ToolImpl } from ".";

export const viewRepoMapImpl: ToolImpl = async (args, extras) => {
  const path =
    typeof args?.path === "string"
      ? args.path.trim()
      : typeof args?.directory_path === "string"
        ? args.directory_path.trim()
        : "";
  const query = typeof args?.query === "string" ? args.query.trim() : "";
  const repoMap = await generateRepoMap(extras.llm, extras.ide, {
    outputRelativeUriPaths: true,
    includeSignatures: true,
    path: path || undefined,
    query: query || undefined,
  });
  return [
    {
      name: "Repository Structure",
      description: path
        ? `Outline of ${path}`
        : "Outline of the code repository structure",
      content: repoMap,
    },
  ];
};
