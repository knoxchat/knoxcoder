import { ConfigYaml } from "knoxdev-package/config-yaml";

/**
 * Default `@` context providers for new VS Code installs.
 * Kept in sync with `DEFAULT_CONTEXT_PROVIDER_TITLES` in
 * `core/context/providers/defaultProviders.ts`.
 *
 * Note: `file` is also ensured at load time; listing it here documents the set.
 */
export const defaultContextProvidersVsCode: NonNullable<
  ConfigYaml["context"]
>[number][] = [
  { provider: "file" },
  { provider: "diff" },
  { provider: "problems" },
  { provider: "repo-map" },
  { provider: "terminal" },
  { provider: "memory" },
];

export const defaultConfig: ConfigYaml = {
  name: "Knox",
  version: "1.0.0",
  schema: "v1",
  models: [],
  context: defaultContextProvidersVsCode,
};
