import { t } from "../i18n/index.js";
import { USER_AGENT, attributionHeaders } from "../auth/openrouterOAuth/constants.js";
import { getOpenRouterOAuthApiKey } from "../auth/openrouterOAuth/session.js";
import {
  deriveEnrichedModelParams,
  modelSupportsImageInput,
  modelSupportsImageOutput,
  modelSupportsParameter,
  modelSupportsReasoningFromSupportedParameters,
  modelSupportsToolsFromSupportedParameters,
  modelSupportsWebSearchFromMetadata,
  type KnoxChatModelMetadata,
  type KnoxChatModelsDiskAdapter,
} from "./knoxChatModels.js";

export type { KnoxChatModelMetadata };

/** OpenRouter catalog — documented list endpoint (not /endpoints or frontend). */
export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
export const OPENROUTER_MODELS_PERSIST_KEY = "openrouterModelsCache.v2";
const CACHE_DURATION = 24 * 60 * 60 * 1000;

/**
 * Titles-only curated coding models used when the live catalog is unreachable.
 * Slugs match OpenRouter ids.
 */
export const OPENROUTER_FALLBACK_MODELS: KnoxChatModelMetadata[] = [
  {
    id: "anthropic/claude-sonnet-5.5",
    name: "Claude Sonnet 5.5",
    supported_parameters: ["tools", "tool_choice"],
  },
  {
    id: "openai/gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    supported_parameters: ["tools", "tool_choice"],
  },
  {
    id: "google/gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    supported_parameters: ["tools", "tool_choice"],
  },
];

type PersistedCatalog = {
  version: 1;
  savedAt: number;
  models: KnoxChatModelMetadata[];
};

let openrouterModelsCache: KnoxChatModelMetadata[] = [];
let cacheTimestamp = 0;
let inflightPromise: Promise<KnoxChatModelMetadata[]> | undefined;
let didAttemptHydrate = false;
let diskAdapter: KnoxChatModelsDiskAdapter | undefined;

export function registerOpenRouterModelsDiskAdapter(
  adapter: KnoxChatModelsDiskAdapter,
): void {
  diskAdapter = adapter;
}

function isPersistedCatalog(value: unknown): value is PersistedCatalog {
  if (!value || typeof value !== "object") {
    return false;
  }
  const catalog = value as PersistedCatalog;
  return (
    catalog.version === 1 &&
    typeof catalog.savedAt === "number" &&
    Array.isArray(catalog.models) &&
    catalog.models.length > 0
  );
}

function applyPersistedCatalog(catalog: PersistedCatalog): void {
  openrouterModelsCache = adoptOpenRouterCatalog(catalog.models);
  cacheTimestamp = catalog.savedAt;
}

export function hydrateOpenRouterModelsCacheFromDisk(): void {
  if (didAttemptHydrate || openrouterModelsCache.length > 0) {
    return;
  }
  didAttemptHydrate = true;

  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(OPENROUTER_MODELS_PERSIST_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (isPersistedCatalog(parsed)) {
          applyPersistedCatalog(parsed);
          return;
        }
      }
    }
  } catch {
    // ignore
  }

  try {
    const raw = diskAdapter?.readSync();
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (isPersistedCatalog(parsed)) {
      applyPersistedCatalog(parsed);
    }
  } catch {
    // Restricted env / corrupt file
  }
}

function persistOpenRouterModelsCatalog(
  models: KnoxChatModelMetadata[],
  savedAt: number,
): void {
  if (!models.length) {
    return;
  }
  const payload: PersistedCatalog = {
    version: 1,
    savedAt,
    models,
  };
  const serialized = JSON.stringify(payload);

  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(OPENROUTER_MODELS_PERSIST_KEY, serialized);
    }
  } catch {
    // ignore quota / private mode
  }

  if (!diskAdapter) {
    return;
  }
  void diskAdapter.write(serialized).catch(() => {
    // Restricted env / disk full
  });
}

function matchesModelId(
  metadata: KnoxChatModelMetadata,
  modelId: string,
): boolean {
  return metadata.id === modelId || metadata.root === modelId;
}

function catalogWithFallback(
  models: KnoxChatModelMetadata[],
): KnoxChatModelMetadata[] {
  return models.length > 0 ? models : OPENROUTER_FALLBACK_MODELS;
}

function parseOpenRouterPrice(raw: unknown): number | undefined {
  if (raw === null || raw === undefined || raw === "") {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function openRouterTokenPriceSum(
  pricing: KnoxChatModelMetadata["pricing"] | undefined,
): number {
  const prompt = parseOpenRouterPrice(pricing?.prompt);
  const completion = parseOpenRouterPrice(pricing?.completion);
  if (prompt === undefined || completion === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  return prompt + completion;
}

/**
 * `GET /api/v1/models` returns both a canonical slug (typical provider list
 * price, e.g. z-ai/glm-5.3-flash at $0.15/$0.50) and a `~*-latest` alias whose
 * `pricing` is the advertised floor (e.g. ~z-ai/glm-flash-latest at
 * $0.02/$0.2475). Copy cheaper alias pricing onto the target so badges and
 * cost math match the models endpoint / OpenRouter website.
 */
export function applyOpenRouterAliasFloorPricing(
  models: KnoxChatModelMetadata[],
): KnoxChatModelMetadata[] {
  const floorByTarget = new Map<string, KnoxChatModelMetadata["pricing"]>();
  for (const model of models) {
    const slug = model.alias_target?.slug;
    if (!slug || !model.pricing) {
      continue;
    }
    const existing = floorByTarget.get(slug);
    if (openRouterTokenPriceSum(model.pricing) < openRouterTokenPriceSum(existing)) {
      floorByTarget.set(slug, model.pricing);
    }
  }
  if (floorByTarget.size === 0) {
    return models;
  }
  return models.map((model) => {
    const floor = floorByTarget.get(model.id);
    if (!floor || openRouterTokenPriceSum(floor) >= openRouterTokenPriceSum(model.pricing)) {
      return model;
    }
    return { ...model, pricing: floor };
  });
}

function adoptOpenRouterCatalog(
  models: KnoxChatModelMetadata[],
): KnoxChatModelMetadata[] {
  return applyOpenRouterAliasFloorPricing(models);
}

function openRouterCatalogHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    ...attributionHeaders(),
  };
  const apiKey = getOpenRouterOAuthApiKey();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

/**
 * Seed / replace the OpenRouter models cache (e.g. after an authenticated fetch).
 * Also persists last-good catalog for offline / cold-start sync lookups.
 */
export function seedOpenRouterModelsCache(
  models: KnoxChatModelMetadata[],
): void {
  if (!Array.isArray(models) || models.length === 0) {
    return;
  }
  openrouterModelsCache = adoptOpenRouterCatalog(models);
  cacheTimestamp = Date.now();
  didAttemptHydrate = true;
  persistOpenRouterModelsCatalog(openrouterModelsCache, cacheTimestamp);
}

/**
 * Fetches OpenRouter models and caches them for 24h.
 * Sends Bearer when a session key exists; the public list is used otherwise.
 * Falls back to last-good persisted catalog, then curated coding models.
 */
export async function getOpenRouterModels(): Promise<KnoxChatModelMetadata[]> {
  hydrateOpenRouterModelsCacheFromDisk();
  const now = Date.now();

  if (
    openrouterModelsCache.length > 0 &&
    now - cacheTimestamp < CACHE_DURATION
  ) {
    return openrouterModelsCache;
  }

  if (inflightPromise) {
    return inflightPromise;
  }

  inflightPromise = (async () => {
    try {
      const response = await fetch(OPENROUTER_MODELS_URL, {
        headers: openRouterCatalogHeaders(),
      });
      if (!response.ok) {
        throw new Error(
          t("failedToFetchModels", { status: response.statusText }),
        );
      }

      const data = await response.json();
      const models = Array.isArray(data?.data) ? data.data : [];
      if (models.length > 0) {
        openrouterModelsCache = adoptOpenRouterCatalog(models);
        cacheTimestamp = Date.now();
        persistOpenRouterModelsCatalog(openrouterModelsCache, cacheTimestamp);
      }
      return catalogWithFallback(openrouterModelsCache);
    } catch (error) {
      console.warn(t("failedToFetchOpenRouterModels"), error);
      hydrateOpenRouterModelsCacheFromDisk();
      return catalogWithFallback(openrouterModelsCache);
    } finally {
      inflightPromise = undefined;
    }
  })();

  return inflightPromise;
}

export async function preloadOpenRouterModels(): Promise<void> {
  hydrateOpenRouterModelsCacheFromDisk();
  await getOpenRouterModels();
}

export function findOpenRouterModelSync(
  modelId: string,
): KnoxChatModelMetadata | undefined {
  hydrateOpenRouterModelsCacheFromDisk();
  if (openrouterModelsCache.length === 0) {
    return undefined;
  }
  return openrouterModelsCache.find((m) => matchesModelId(m, modelId));
}

/** Test helper — clear RAM + hydrate flag (does not delete disk/localStorage). */
export function __resetOpenRouterModelsCacheForTests(): void {
  openrouterModelsCache = [];
  cacheTimestamp = 0;
  inflightPromise = undefined;
  didAttemptHydrate = false;
  diskAdapter = undefined;
}

function syncLookupBoolean(
  modelId: string,
  predicate: (metadata: KnoxChatModelMetadata) => boolean,
): boolean | undefined {
  const modelData = findOpenRouterModelSync(modelId);
  if (!modelData) {
    return undefined;
  }
  return predicate(modelData);
}

export function checkOpenRouterToolSupportSync(
  modelId: string,
): boolean | undefined {
  return syncLookupBoolean(modelId, (m) =>
    modelSupportsToolsFromSupportedParameters(m.supported_parameters),
  );
}

export function checkOpenRouterImageSupportSync(
  modelId: string,
): boolean | undefined {
  return syncLookupBoolean(modelId, modelSupportsImageInput);
}

export function checkOpenRouterImageOutputSupportSync(
  modelId: string,
): boolean | undefined {
  return syncLookupBoolean(modelId, modelSupportsImageOutput);
}

export function checkOpenRouterReasoningSupportSync(
  modelId: string,
): boolean | undefined {
  return syncLookupBoolean(modelId, (m) =>
    modelSupportsReasoningFromSupportedParameters(m.supported_parameters),
  );
}

export function checkOpenRouterWebSearchSupportSync(
  modelId: string,
): boolean | undefined {
  return syncLookupBoolean(modelId, modelSupportsWebSearchFromMetadata);
}

export function checkOpenRouterParameterSupportSync(
  modelId: string,
  parameter: string,
): boolean | undefined {
  return syncLookupBoolean(modelId, (m) =>
    modelSupportsParameter(m.supported_parameters, parameter),
  );
}

async function checkOpenRouterToolSupport(modelId: string): Promise<boolean> {
  try {
    const models = await getOpenRouterModels();
    const modelData = models.find((m) => matchesModelId(m, modelId));
    if (!modelData) {
      return false;
    }
    return modelSupportsToolsFromSupportedParameters(
      modelData.supported_parameters,
    );
  } catch (error) {
    console.warn(`Error checking tool support for ${modelId}:`, error);
    return false;
  }
}

export { checkOpenRouterToolSupport };

export function shouldEnrichFromOpenRouterApi(model: {
  providerName: string;
  apiBase?: string;
}): boolean {
  if (model.providerName === "openrouter") {
    return true;
  }
  const apiBase = model.apiBase?.toLowerCase() ?? "";
  return apiBase.includes("openrouter.ai");
}

type EnrichableModel = {
  providerName: string;
  model: string;
  apiBase?: string;
  contextLength?: number;
  completionOptions?: {
    maxTokens?: number;
  };
  capabilities?: {
    tools?: boolean;
    uploadImage?: boolean;
    imageOutput?: boolean;
    reasoning?: boolean;
    webSearch?: boolean;
  };
  supportedParameters?: string[];
  inputModalities?: string[];
  outputModalities?: string[];
};

export async function enrichOpenRouterModelCapabilitiesFromApi(
  models: EnrichableModel[],
): Promise<void> {
  const needsEnrichment = models.some(shouldEnrichFromOpenRouterApi);
  if (!needsEnrichment) {
    return;
  }

  const apiModels = await getOpenRouterModels();
  if (apiModels.length === 0) {
    return;
  }

  const apiModelMap = new Map<string, KnoxChatModelMetadata>();
  for (const apiModel of apiModels) {
    apiModelMap.set(apiModel.id, apiModel);
    if (apiModel.root) {
      apiModelMap.set(apiModel.root, apiModel);
    }
  }

  for (const model of models) {
    if (!shouldEnrichFromOpenRouterApi(model)) {
      continue;
    }

    const apiModel = apiModelMap.get(model.model);
    if (!apiModel) {
      continue;
    }

    const enriched = deriveEnrichedModelParams(apiModel);

    if (enriched.contextLength !== undefined) {
      model.contextLength = enriched.contextLength;
    }

    if (enriched.maxTokens !== undefined) {
      model.completionOptions = {
        ...model.completionOptions,
        maxTokens: enriched.maxTokens,
      };
    }

    model.capabilities = {
      ...model.capabilities,
      ...enriched.capabilities,
    };

    if (enriched.supportedParameters) {
      model.supportedParameters = enriched.supportedParameters;
    }
    if (enriched.inputModalities) {
      model.inputModalities = enriched.inputModalities;
    }
    if (enriched.outputModalities) {
      model.outputModalities = enriched.outputModalities;
    }
  }
}
