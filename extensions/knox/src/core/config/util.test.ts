import { describe, expect, it } from "vitest";

import { addModelSelectRole, existingYamlModelName, providerDisplayName, uniqueYamlModelName } from "./util";

describe("addModelSelectRole", () => {
  it("selects the composer model for every add", () => {
    expect(addModelSelectRole(undefined)).toBe("chat");
    expect(addModelSelectRole("chat")).toBe("chat");
    expect(addModelSelectRole("edit")).toBe("chat");
    expect(addModelSelectRole("inlineEdit")).toBe("chat");
    expect(addModelSelectRole("apply")).toBe("chat");
    expect(addModelSelectRole("applyCodeBlock")).toBe("chat");
    expect(addModelSelectRole("viewRead")).toBe("chat");
  });
});

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

describe("existingYamlModelName", () => {
  it("returns the yaml name for the same provider and model id", () => {
    expect(
      existingYamlModelName(
        [
          {
            name: "OpenRouter · Anthropic: Claude Haiku 5.5",
            provider: "openrouter",
            model: "anthropic/claude-haiku-5.5",
          },
        ],
        "openrouter",
        "anthropic/claude-haiku-5.5",
      ),
    ).toBe("OpenRouter · Anthropic: Claude Haiku 5.5");
  });

  it("ignores the same catalog id from another provider", () => {
    expect(
      existingYamlModelName(
        [
          {
            name: "Anthropic: Claude Haiku 5.5",
            provider: "knoxchat",
            model: "anthropic/claude-haiku-5.5",
          },
        ],
        "openrouter",
        "anthropic/claude-haiku-5.5",
      ),
    ).toBeUndefined();
  });
});
