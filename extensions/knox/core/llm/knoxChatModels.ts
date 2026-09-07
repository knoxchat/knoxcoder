import { t } from "../i18n/index.js";

/**
 * Optional OpenRouter-style reasoning metadata on /v1/models entries.
 * When present, effort UI must use these values (no GUI allow-lists).
 */
export interface KnoxChatModelReasoningMetadata {
  supported_efforts?: string[] | null;
  default_effort?: string | null;
  default_enabled?: boolean;
  mandatory?: boolean;
  supports_max_tokens?: boolean;
}

/**
 * Model metadata from KnoxChat / OpenAI-compatible List Models endpoints
 * (https://api.knox.chat/v1/models?interactive=true).
 */
export interface KnoxChatModelMetadata {
  id: string;
  root?: string | null;
  name?: string;
  description?: string | null;
  chinese_description?: string | null;
  context_length?: number;
  created?: number;
  last_updated?: number;
  release_date?: string | null;
  logo_url?: string | null;
  object?: string;
  parent?: string | null;
  developer?: string | null;
  owned_by?: string | null;
  is_provider_model?: boolean;
  supported_parameters?: string[];
  /** Present on some gateways; preferred source for effort enums */
  reasoning?: KnoxChatModelReasoningMetadata;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    modality?: string | null;
    tokenizer?: string | null;
    instruct_type?: string | null;
  };
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number | null;
    is_moderated?: boolean;
  };
  max_completion_tokens?: number | null;
  pricing?: {
    prompt?: string | null;
    completion?: string | null;
    image?: string | null;
    input_cache_read?: string | null;
    input_cache_write?: string | null;
    web_search?: string | null;
  };
  pricing_in_display_units?: boolean;
  provider_info?: {
    provider_name?: string | null;
    provider_logo_url?: string | null;
  } | null;
  permission?: Array<{
    id?: string;
    object?: string;
    created?: number;
    allow_create_engine?: boolean;
    allow_sampling?: boolean;
    allow_logprobs?: boolean;
    allow_search_indices?: boolean;
    allow_view?: boolean;
    allow_fine_tuning?: boolean;
    organization?: string;
    group?: string | null;
    is_blocking?: boolean;
  }>;
}

export interface ModelPricingFromApi {
  /** USD per 1K prompt tokens */
  promptPer1k: number;
  /** USD per 1K completion tokens */
  completionPer1k: number;
  /** USD per image, when available */
  image?: number;
  /** USD per 1K cached input-read tokens */
  cacheReadPer1k?: number;
  /** USD per 1K cached input-write tokens */
  cacheWritePer1k?: number;
  /** USD per web search request */
  webSearch?: number;
}

export interface ModelCapabilitiesFromApi {
  tools: boolean;
  uploadImage: boolean;
  imageOutput: boolean;
  reasoning: boolean;
  webSearch: boolean;
}

export interface EnrichedModelParams {
  contextLength?: number;
  maxTokens?: number;
  capabilities: ModelCapabilitiesFromApi;
  supportedParameters?: string[];
  inputModalities?: string[];
  outputModalities?: string[];
  pricing?: ModelPricingFromApi;
  isModerated?: boolean;
  isProviderModel?: boolean;
  developer?: string;
  tokenizer?: string;
}

/** Interactive catalog — preferred for UI (pricing, modalities, capabilities). */
export const KNOX_CHAT_MODELS_URL =
  "https://api.knox.chat/v1/models?interactive=true";
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const PERSIST_KEY = "knoxChatModelsCache.v1";

type PersistedCatalog = {
  version: 1;
  savedAt: number;
  models: KnoxChatModelMetadata[];
};

/** Optional Node disk backend — never import `node:*` from this module (GUI-safe). */
export interface KnoxChatModelsDiskAdapter {
  readSync(): string | null;
  write(serialized: string): Promise<void>;
}

let knoxChatModelsCache: KnoxChatModelMetadata[] = [];
let cacheTimestamp = 0;
let inflightPromise: Promise<KnoxChatModelMetadata[]> | undefined;
let didAttemptHydrate = false;
let diskAdapter: KnoxChatModelsDiskAdapter | undefined;

/**
 * Register Node FS persistence for `~/.knox/knoxChatModelsCache.json`.
 * Call from VS Code / binary hosts only — GUI uses localStorage alone.
 */
export function registerKnoxChatModelsDiskAdapter(
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
  knoxChatModelsCache = catalog.models;
  cacheTimestamp = catalog.savedAt;
}

/**
 * Hydrate RAM cache from last-good catalog (localStorage and/or Node disk adapter).
 * Safe to call repeatedly; no-ops once warm or after first attempt.
 */
export function hydrateKnoxChatModelsCacheFromDisk(): void {
  if (didAttemptHydrate || knoxChatModelsCache.length > 0) {
    return;
  }
  didAttemptHydrate = true;

  // GUI / browser last-good
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(PERSIST_KEY);
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

  // Core / Node last-good (registered adapter — no node:* imports here)
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

function persistKnoxChatModelsCatalog(
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
      localStorage.setItem(PERSIST_KEY, serialized);
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

function finitePositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function isUnlimitedContext(value: unknown): boolean {
  return value === -1 || value === Number.POSITIVE_INFINITY;
}

function parsePricingNumber(raw: string | null | undefined): number | undefined {
  if (raw == null || raw === "") {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value === -1) {
    return undefined;
  }
  return value;
}

function matchesModelId(
  metadata: KnoxChatModelMetadata,
  modelId: string,
): boolean {
  return metadata.id === modelId || metadata.root === modelId;
}

/**
 * Context length from API metadata.
 * Returns Infinity when the API reports unlimited context (-1).
 */
export function getMetadataContextLength(
  metadata: KnoxChatModelMetadata,
): number | undefined {
  const top = metadata.top_provider?.context_length;
  const root = metadata.context_length;

  if (isUnlimitedContext(top) || isUnlimitedContext(root)) {
    return Number.POSITIVE_INFINITY;
  }

  return finitePositiveNumber(top) ?? finitePositiveNumber(root);
}

/**
 * Max completion / generation tokens from API metadata.
 */
export function getMetadataMaxCompletionTokens(
  metadata: KnoxChatModelMetadata,
): number | undefined {
  return (
    finitePositiveNumber(metadata.top_provider?.max_completion_tokens) ??
    finitePositiveNumber(metadata.max_completion_tokens)
  );
}

/**
 * Recommended maxTokens for requests: API max completion tokens,
 * capped to contextLength/4 when context is finite.
 */
export function getRecommendedMaxTokens(
  metadata: KnoxChatModelMetadata,
): number | undefined {
  const maxCompletionTokens = getMetadataMaxCompletionTokens(metadata);
  if (maxCompletionTokens === undefined) {
    return undefined;
  }

  const contextLength = getMetadataContextLength(metadata);
  if (contextLength !== undefined && Number.isFinite(contextLength)) {
    return Math.min(maxCompletionTokens, Math.floor(contextLength / 4));
  }

  return maxCompletionTokens;
}

export function modelSupportsParameter(
  supportedParameters: string[] | undefined,
  parameter: string,
): boolean {
  return !!supportedParameters?.includes(parameter);
}

export function modelSupportsAnyParameter(
  supportedParameters: string[] | undefined,
  parameters: string[],
): boolean {
  if (!supportedParameters?.length) {
    return false;
  }
  const params = new Set(supportedParameters);
  return parameters.some((parameter) => params.has(parameter));
}

export function modelSupportsToolsFromSupportedParameters(
  supportedParameters: string[] | undefined,
): boolean {
  return modelSupportsAnyParameter(supportedParameters, [
    "tools",
    "tool_choice",
  ]);
}

export function modelSupportsReasoningFromSupportedParameters(
  supportedParameters: string[] | undefined,
): boolean {
  return modelSupportsAnyParameter(supportedParameters, [
    "reasoning",
    "reasoning_effort",
    "include_reasoning",
  ]);
}

export function modelSupportsWebSearchFromMetadata(
  metadata: KnoxChatModelMetadata,
): boolean {
  if (
    modelSupportsAnyParameter(metadata.supported_parameters, [
      "web_search",
      "web_search_options",
    ])
  ) {
    return true;
  }

  // Some Knox provider models advertise web search via pricing only
  return parsePricingNumber(metadata.pricing?.web_search) !== undefined;
}

export function modelSupportsImageInput(
  metadata: KnoxChatModelMetadata,
): boolean {
  return metadata.architecture?.input_modalities?.includes("image") ?? false;
}

export function modelSupportsImageOutput(
  metadata: KnoxChatModelMetadata,
): boolean {
  return metadata.architecture?.output_modalities?.includes("image") ?? false;
}

export function modelSupportsModality(
  metadata: KnoxChatModelMetadata,
  modality: string,
  direction: "input" | "output" = "input",
): boolean {
  const modalities =
    direction === "input"
      ? metadata.architecture?.input_modalities
      : metadata.architecture?.output_modalities;
  return modalities?.includes(modality) ?? false;
}

/**
 * Convert API pricing strings into USD-per-1K (or per-request) values.
 * When pricing_in_display_units is true, token prices are $/1M tokens.
 * Otherwise token prices are $/token.
 */
export function getModelPricingFromMetadata(
  metadata: KnoxChatModelMetadata,
): ModelPricingFromApi | undefined {
  const prompt = parsePricingNumber(metadata.pricing?.prompt);
  const completion = parsePricingNumber(metadata.pricing?.completion);
  if (prompt === undefined || completion === undefined) {
    return undefined;
  }

  const scaleTokenPrice = (value: number) =>
    metadata.pricing_in_display_units ? value / 1000 : value * 1000;

  const image = parsePricingNumber(metadata.pricing?.image);
  const cacheRead = parsePricingNumber(metadata.pricing?.input_cache_read);
  const cacheWrite = parsePricingNumber(metadata.pricing?.input_cache_write);
  const webSearch = parsePricingNumber(metadata.pricing?.web_search);

  return {
    promptPer1k: scaleTokenPrice(prompt),
    completionPer1k: scaleTokenPrice(completion),
    ...(image !== undefined ? { image } : {}),
    ...(cacheRead !== undefined
      ? { cacheReadPer1k: scaleTokenPrice(cacheRead) }
      : {}),
    ...(cacheWrite !== undefined
      ? { cacheWritePer1k: scaleTokenPrice(cacheWrite) }
      : {}),
    ...(webSearch !== undefined ? { webSearch } : {}),
  };
}

/** Format a USD amount for model-picker badges (strip useless trailing zeros). */
export function formatUsdAmount(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  if (Math.abs(value - Math.round(value)) < 1e-9) {
    return String(Math.round(value));
  }
  if (Math.abs(value) >= 0.01) {
    return value.toFixed(2).replace(/\.?0+$/, "");
  }
  return value.toFixed(4).replace(/\.?0+$/, "");
}

/**
 * Badge / tooltip strings for prompt/completion as $/1M tokens.
 * Internal pricing stays USD-per-1K for cost math.
 */
export function formatModelPricingPerMillion(
  pricing: Pick<ModelPricingFromApi, "promptPer1k" | "completionPer1k">,
): { badge: string; title: string } {
  const promptPer1m = pricing.promptPer1k * 1000;
  const completionPer1m = pricing.completionPer1k * 1000;
  const prompt = formatUsdAmount(promptPer1m);
  const completion = formatUsdAmount(completionPer1m);
  return {
    badge: `$${prompt}/${completion}`,
    title: `$${prompt} / $${completion} per 1M tokens`,
  };
}

export function deriveEnrichedModelParams(
  metadata: KnoxChatModelMetadata,
): EnrichedModelParams {
  return {
    contextLength: getMetadataContextLength(metadata),
    maxTokens: getRecommendedMaxTokens(metadata),
    capabilities: {
      tools: modelSupportsToolsFromSupportedParameters(
        metadata.supported_parameters,
      ),
      uploadImage: modelSupportsImageInput(metadata),
      imageOutput: modelSupportsImageOutput(metadata),
      reasoning: modelSupportsReasoningFromSupportedParameters(
        metadata.supported_parameters,
      ),
      webSearch: modelSupportsWebSearchFromMetadata(metadata),
    },
    supportedParameters: metadata.supported_parameters,
    inputModalities: metadata.architecture?.input_modalities,
    outputModalities: metadata.architecture?.output_modalities,
    pricing: getModelPricingFromMetadata(metadata),
    isModerated: metadata.top_provider?.is_moderated,
    isProviderModel: metadata.is_provider_model,
    developer: metadata.developer ?? metadata.owned_by ?? undefined,
    tokenizer: metadata.architecture?.tokenizer ?? undefined,
  };
}

/**
 * Seed / replace the shared KnoxChat models cache (e.g. after an authenticated fetch).
 * Also persists last-good catalog for offline / cold-start sync lookups.
 */
export function seedKnoxChatModelsCache(
  models: KnoxChatModelMetadata[],
): void {
  if (!Array.isArray(models) || models.length === 0) {
    return;
  }
  knoxChatModelsCache = models;
  cacheTimestamp = Date.now();
  didAttemptHydrate = true;
  persistKnoxChatModelsCatalog(knoxChatModelsCache, cacheTimestamp);
}

/**
 * Fetches KnoxChat models and caches them for 24h.
 * Falls back to last-good persisted catalog when the network fails.
 */
export async function getKnoxChatModels(): Promise<KnoxChatModelMetadata[]> {
  hydrateKnoxChatModelsCacheFromDisk();
  const now = Date.now();

  if (
    knoxChatModelsCache.length > 0 &&
    now - cacheTimestamp < CACHE_DURATION
  ) {
    return knoxChatModelsCache;
  }

  if (inflightPromise) {
    return inflightPromise;
  }

  inflightPromise = (async () => {
    try {
      const response = await fetch(KNOX_CHAT_MODELS_URL);
      if (!response.ok) {
        throw new Error(
          t("failedToFetchModels", { status: response.statusText }),
        );
      }

      const data = await response.json();
      const models = Array.isArray(data?.data) ? data.data : [];
      if (models.length > 0) {
        knoxChatModelsCache = models;
        cacheTimestamp = Date.now();
        persistKnoxChatModelsCatalog(knoxChatModelsCache, cacheTimestamp);
      }
      return knoxChatModelsCache;
    } catch (error) {
      console.warn(t("failedToFetchKnoxChatModels"), error);
      // Keep serving last-good RAM / disk catalog
      hydrateKnoxChatModelsCacheFromDisk();
      return knoxChatModelsCache;
    } finally {
      inflightPromise = undefined;
    }
  })();

  return inflightPromise;
}

/**
 * Preloads the KnoxChat models cache so synchronous lookups can succeed.
 * Hydrates last-good disk/localStorage first, then refreshes from the network.
 */
export async function preloadKnoxChatModels(): Promise<void> {
  hydrateKnoxChatModelsCacheFromDisk();
  await getKnoxChatModels();
}

export function findKnoxChatModelSync(
  modelId: string,
): KnoxChatModelMetadata | undefined {
  hydrateKnoxChatModelsCacheFromDisk();
  if (knoxChatModelsCache.length === 0) {
    return undefined;
  }
  return knoxChatModelsCache.find((m) => matchesModelId(m, modelId));
}

/** Test helper — clear RAM + hydrate flag (does not delete disk/localStorage). */
export function __resetKnoxChatModelsCacheForTests(): void {
  knoxChatModelsCache = [];
  cacheTimestamp = 0;
  inflightPromise = undefined;
  didAttemptHydrate = false;
  diskAdapter = undefined;
}

function syncLookupBoolean(
  modelId: string,
  predicate: (metadata: KnoxChatModelMetadata) => boolean,
): boolean | undefined {
  const modelData = findKnoxChatModelSync(modelId);
  // Unknown id → undefined (not false) so persisted capabilities / autodetection
  // remain usable for new or aliased model ids before the next catalog refresh.
  if (!modelData) {
    return undefined;
  }
  return predicate(modelData);
}

/**
 * Synchronous tool-support lookup using the in-memory KnoxChat models cache.
 */
export function checkKnoxChatToolSupportSync(
  modelId: string,
): boolean | undefined {
  return syncLookupBoolean(modelId, (m) =>
    modelSupportsToolsFromSupportedParameters(m.supported_parameters),
  );
}

/**
 * Synchronous image-input lookup using the in-memory KnoxChat models cache.
 */
export function checkKnoxChatImageSupportSync(
  modelId: string,
): boolean | undefined {
  return syncLookupBoolean(modelId, modelSupportsImageInput);
}

/**
 * Synchronous image-output lookup using the in-memory KnoxChat models cache.
 */
export function checkKnoxChatImageOutputSupportSync(
  modelId: string,
): boolean | undefined {
  return syncLookupBoolean(modelId, modelSupportsImageOutput);
}

/**
 * Synchronous reasoning-support lookup using the in-memory KnoxChat models cache.
 */
export function checkKnoxChatReasoningSupportSync(
  modelId: string,
): boolean | undefined {
  return syncLookupBoolean(modelId, (m) =>
    modelSupportsReasoningFromSupportedParameters(m.supported_parameters),
  );
}

/**
 * Synchronous web-search lookup using the in-memory KnoxChat models cache.
 */
export function checkKnoxChatWebSearchSupportSync(
  modelId: string,
): boolean | undefined {
  return syncLookupBoolean(modelId, modelSupportsWebSearchFromMetadata);
}

/**
 * Synchronous supported_parameters membership check.
 */
export function checkKnoxChatParameterSupportSync(
  modelId: string,
  parameter: string,
): boolean | undefined {
  return syncLookupBoolean(modelId, (m) =>
    modelSupportsParameter(m.supported_parameters, parameter),
  );
}

async function checkKnoxChatToolSupport(modelId: string): Promise<boolean> {
  try {
    const models = await getKnoxChatModels();
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

export { checkKnoxChatToolSupport };

export function shouldEnrichFromKnoxChatApi(model: {
  providerName: string;
  apiBase?: string;
}): boolean {
  if (model.providerName === "knoxchat") {
    return true;
  }

  const apiBase = model.apiBase?.toLowerCase() ?? "";
  return apiBase.includes("knox.chat") || apiBase.includes("api.knox");
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

/**
 * Enriches model instances from KnoxChat /v1/models metadata:
 * context length, max tokens, capabilities, modalities, and supported parameters.
 */
export async function enrichKnoxChatModelCapabilitiesFromApi(
  models: EnrichableModel[],
): Promise<void> {
  const needsEnrichment = models.some(shouldEnrichFromKnoxChatApi);
  if (!needsEnrichment) {
    return;
  }

  const apiModels = await getKnoxChatModels();
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
    if (!shouldEnrichFromKnoxChatApi(model)) {
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

/**
 * Look up API pricing for a model from the KnoxChat cache (sync).
 */
export function getKnoxChatModelPricingSync(
  modelId: string,
): ModelPricingFromApi | undefined {
  const modelData = findKnoxChatModelSync(modelId);
  if (!modelData) {
    return undefined;
  }
  return getModelPricingFromMetadata(modelData);
}

/**
 * Bare o-series model IDs (o1, o3, o4…) — not `openai/gpt-*` prefixes.
 */
export function isOpenAIReasoningSeriesModel(model?: string): boolean {
  if (!model) {
    return false;
  }
  const bare = model.includes("/") ? model.split("/").pop()! : model;
  return /^(o1|o3|o4)(-|$)/i.test(bare);
}
