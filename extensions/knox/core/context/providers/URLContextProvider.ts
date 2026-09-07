import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { NodeHtmlMarkdown } from "node-html-markdown";

import { BaseContextProvider } from "../";
import { t } from "../../i18n/index.js";
import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
} from "../../index.js";

class URLContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "url",
    displayTitle: "URL",
    description: t("givenUrlWebpage"),
    type: "query",
  };

  async getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    try {
      const url = new URL(query);
      const icon = undefined;
      const resp = await extras.fetch(url);
      const html = await resp.text();

      const dom = new JSDOM(html);
      let reader = new Readability(dom.window.document);
      let article = reader.parse();
      const content = article?.content || "";
      const markdown = NodeHtmlMarkdown.translate(
        content,
        {},
        undefined,
        undefined,
      );

      const title = article?.title || url.pathname;

      return [
        {
          icon,
          description: url.toString(),
          content: markdown,
          name: title,
          uri: {
            type: "url",
            value: url.toString(),
          },
        },
      ];
    } catch (e) {
      console.log(e);
      return [];
    }
  }
}

export default URLContextProvider;
