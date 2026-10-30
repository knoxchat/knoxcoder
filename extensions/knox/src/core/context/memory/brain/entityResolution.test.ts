/**
 * MEM-26 — entity alias groups and validity intervals (pure).
 */
import { describe, expect, it } from "vitest";

import {
  entityAliasGroup,
  entityAliasNames,
  isKnownEntityAlias,
  isValidAt,
  knownAliasTokens,
  namesShareAliasGroup,
  preferredEntityName,
  textMentionsEntityAliases,
} from "./entityResolution.js";

describe("MEM-26 entity aliases", () => {
  it("merges TS / TypeScript onto one preferred name", () => {
    expect(preferredEntityName("TS")).toBe("TypeScript");
    expect(preferredEntityName("typescript")).toBe("TypeScript");
    expect(namesShareAliasGroup("TS", "TypeScript")).toBe(true);
    expect(isKnownEntityAlias("TS")).toBe(true);
    expect(entityAliasGroup("ts")).toContain("TypeScript");
    expect(entityAliasNames("TypeScript")).toContain("TS");
  });

  it("does not invent aliases for unrelated names", () => {
    expect(isKnownEntityAlias("AuthService")).toBe(false);
    expect(namesShareAliasGroup("TypeScript", "JavaScript")).toBe(false);
    expect(preferredEntityName("AuthService")).toBe("AuthService");
  });

  it("treats a query mentioning TS as mentioning TypeScript", () => {
    expect(knownAliasTokens("use TS for the API")).toEqual(["TS"]);
    expect(textMentionsEntityAliases("use TS for the API", "TypeScript")).toBe(true);
    expect(textMentionsEntityAliases("fix the login button", "TypeScript")).toBe(false);
  });
});

describe("MEM-26 validity intervals", () => {
  const now = Date.parse("2026-10-31T00:00:00Z");

  it("treats NULL bounds as always valid", () => {
    expect(isValidAt({}, now)).toBe(true);
    expect(isValidAt({ valid_from: null, valid_to: null }, now)).toBe(true);
  });

  it("excludes not-yet-valid and already-closed rows", () => {
    expect(isValidAt({ valid_from: "2026-11-01 00:00:00" }, now)).toBe(false);
    expect(isValidAt({ valid_to: "2026-10-30 00:00:00" }, now)).toBe(false);
    expect(isValidAt({ valid_from: "2026-10-01 00:00:00", valid_to: "2026-11-01 00:00:00" }, now)).toBe(true);
  });

  it("treats valid_to as exclusive so a just-superseded row leaves Ω(q)", () => {
    expect(isValidAt({ valid_to: "2026-10-31T00:00:00Z" }, now)).toBe(false);
  });
});
