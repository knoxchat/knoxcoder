import { describe, expect, it } from "vitest";

import { providerDisplayName, uniqueYamlModelName } from "./util";

describe("uniqueYamlModelName", () => {
  it("keeps the first title unchanged", () => {
    expect(uniqueYamlModelName([], "Z.ai: GLM 5.3 Flash", "knoxchat")).toBe(
      "Z.ai: GLM 5.3 Flash",
    );
  });

  it("prefixes the provider instead of appending (1)", () => {
    expect(
      uniqueYamlModelName(
        ["Z.ai: GLM 5.3 Flash"],
        "Z.ai: GLM 5.3 Flash",
        "openrouter",
      ),
    ).toBe("OpenRouter · Z.ai: GLM 5.3 Flash");
    expect(
      uniqueYamlModelName(
        ["Z.ai: GLM 5.3 Flash"],
        "Z.ai: GLM 5.3 Flash",
        "knoxchat",
      ),
    ).toBe("KnoxStudio · Z.ai: GLM 5.3 Flash");
  });

  it("increments when the provider-prefixed name is also taken", () => {
    expect(
      uniqueYamlModelName(
        ["Z.ai: GLM 5.3 Flash", "OpenRouter · Z.ai: GLM 5.3 Flash"],
        "Z.ai: GLM 5.3 Flash",
        "openrouter",
      ),
    ).toBe("OpenRouter · Z.ai: GLM 5.3 Flash (1)");
  });

  it("falls back to the raw provider id", () => {
    expect(providerDisplayName("openrouter")).toBe("OpenRouter");
    expect(providerDisplayName("custom-lab")).toBe("custom-lab");
  });

  it("appends (1) when there is no provider label to prefix", () => {
    expect(uniqueYamlModelName(["Local Llama"], "Local Llama")).toBe(
      "Local Llama (1)",
    );
  });
});
