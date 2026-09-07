import { ILLM } from "../..";
import { fetchSearchResults } from "../../context/providers/WebContextProvider";
import { t } from "../../i18n/index.js";
import { modelSupportsWebSearchCapability } from "../../llm/autodetect";

import { ToolImpl } from ".";

/**
 * Whether the tool's routed LLM can perform provider-native web search
 * (web_search / web_search_options), as opposed to Knox retrieval.
 */
export function llmSupportsNativeWebSearch(llm: ILLM): boolean {
  if (llm.capabilities?.webSearch === true) {
    return true;
  }
  if (
    llm.supportedParameters?.includes("web_search") ||
    llm.supportedParameters?.includes("web_search_options")
  ) {
    return true;
  }
  return modelSupportsWebSearchCapability({
    provider: llm.providerName,
    model: llm.model,
    capabilities: llm.capabilities,
  });
}

function formatRetrievalError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const searchWebImpl: ToolImpl = async (args, extras) => {
  // Prefer real Knox retrieval — never treat plain LLM text as "search results".
  try {
    return await fetchSearchResults(args.query, 5, extras.fetch);
  } catch (retrievalError) {
    const retrievalMessage = formatRetrievalError(retrievalError);

    // Only fall back when the routed model actually supports native web_search.
    // Always label the result so it is never mistaken for Knox retrieval.
    if (llmSupportsNativeWebSearch(extras.llm)) {
      try {
        const searchPrompt = `Search the web for: "${args.query}"

Provide up-to-date information with facts and sources when available.`;

        const response = await extras.llm.complete(
          searchPrompt,
          new AbortController().signal,
          { webSearch: true },
        );

        return [
          {
            name: t("providerNativeWebSearchResults"),
            description: t("providerNativeWebSearchDescription", {
              query: args.query,
            }),
            content: `${t("providerNativeWebSearchNotice")}\n\n${response}`,
          },
        ];
      } catch (nativeError) {
        throw new Error(
          t("webSearchFailed", {
            error: `${retrievalMessage}; native web search also failed: ${formatRetrievalError(nativeError)}`,
          }),
        );
      }
    }

    throw new Error(
      t("webSearchFailed", {
        error: `${retrievalMessage}. ${t("webSearchNoHallucinationFallback")}`,
      }),
    );
  }
};
