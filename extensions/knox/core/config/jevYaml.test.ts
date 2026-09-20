import { describe, expect, it } from "vitest";

import {
  extractJevYamlFromRaw,
  loadJevYamlExperimental,
  parseJevYamlBlock,
} from "./jevYaml";

const SAMPLE = `
name: Knox
version: 1.0.0
jev:
  enabled: true
  model: jev-1.13.0
  apiKey: ts-api-key
  timeoutMs: 400
  failOpen: true
  baseUrl: https://api.typesafe.ai
`;

describe("jev YAML config surface", () => {
  it("maps the nested jev: block onto experimental.jev", () => {
    expect(loadJevYamlExperimental(SAMPLE)).toEqual({
      jev: {
        enabled: true,
        model: "jev-1.13.0",
        apiKey: "ts-api-key",
        timeoutMs: 400,
        failOpen: true,
        baseUrl: "https://api.typesafe.ai",
      },
    });
  });

  it("rejects invalid values", () => {
    expect(parseJevYamlBlock({ enabled: "yes" })).toBeUndefined();
    expect(parseJevYamlBlock({ timeoutMs: 5 })).toBeUndefined();
    expect(extractJevYamlFromRaw(SAMPLE)).toMatchObject({ enabled: true });
    expect(loadJevYamlExperimental("name: x\nversion: 0\n")).toEqual({});
  });
});
