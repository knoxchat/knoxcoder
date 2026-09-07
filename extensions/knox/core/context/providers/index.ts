import { BaseContextProvider } from "../";
import { ContextProviderName } from "../../";

import {
  Providers,
  contextProviderClassFromName as classFromName,
  createDefaultContextProviders,
  mergeContextProvidersWithDefaults,
  getContextProviderCategory,
  integrationProviderReady,
  INTEGRATION_CONTEXT_PROVIDER_TITLES,
  DEFAULT_CONTEXT_PROVIDER_TITLES,
} from "./defaultProviders";

/**
 * Built-in context providers.
 *
 * Defaults (always on): file, diff, problems, repo-map, terminal, memory.
 * Integrations (opt-in + key-gated): google, discord, greptile, postgres,
 * database, issue, http, web, debugger.
 *
 * CodeOutline / CodeHighlights were removed (stubs returned empty).
 */
export {
  Providers,
  createDefaultContextProviders,
  mergeContextProvidersWithDefaults,
  getContextProviderCategory,
  integrationProviderReady,
  INTEGRATION_CONTEXT_PROVIDER_TITLES,
  DEFAULT_CONTEXT_PROVIDER_TITLES,
};

export function contextProviderClassFromName(
  name: ContextProviderName,
): typeof BaseContextProvider | undefined {
  return classFromName(name);
}
