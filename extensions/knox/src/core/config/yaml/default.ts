import { AssistantUnrolled } from "knoxdev-package/config-yaml";

/** Mirrors `defaultContextProvidersVsCode` in `../default.ts`. */
export const defaultConfigYaml: AssistantUnrolled = {
  models: [],
  context: [
    { provider: "file" },
    { provider: "diff" },
    { provider: "problems" },
    { provider: "repo-map" },
    { provider: "terminal" },
    { provider: "memory" },
  ],
  name: "Knox",
  version: "1.0.0",
  schema: "v1",
};
