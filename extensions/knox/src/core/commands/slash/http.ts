import { SlashCommand } from "../../index.js";
import { t } from "../../i18n/index.js";
import { streamResponse } from "../../llm/stream.js";
import { removeQuotesAndEscapes } from "../../util/index.js";

const HttpSlashCommand: SlashCommand = {
  name: "http",
  description: t("callHttpEndpoint"),
  run: async function* ({ ide, llm, input, params, fetch }) {
    const url = params?.url;
    if (!url) {
      throw new Error(t("urlNotDefined"));
    }
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: removeQuotesAndEscapes(input),
      }),
    });

    // Stream the response
    if (response.body === null) {
      throw new Error(t("responseBodyNull"));
    }
    for await (const chunk of streamResponse(response)) {
      yield chunk;
    }
  },
};

export default HttpSlashCommand;
