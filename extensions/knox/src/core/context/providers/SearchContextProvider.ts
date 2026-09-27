import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
} from "../../index.js";
import { t } from "../../i18n/index.js";
import { BaseContextProvider } from "../index.js";

class SearchContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "search",
    displayTitle: "Search",
    description: t("useRipgrepSearch"),
    type: "query",
    renderInlineAs: "",
  };

  async getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    const results = await extras.ide.getSearchResults(query);
    return [
      {
        description: t("searchResults"),
        content: `${t("searchResultsFor", { query })}\n\n${results}`,
        name: t("searchResults"),
      },
    ];
  }
}

export default SearchContextProvider;
