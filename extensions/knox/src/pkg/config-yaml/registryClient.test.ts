import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  RegistryClient,
  isSafeRegistrySlug,
  localRegistryCandidates,
} from "./registryClient";

describe("RegistryClient local lookup", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("rejects unsafe slugs", () => {
    expect(isSafeRegistrySlug("acme")).toBe(true);
    expect(isSafeRegistrySlug("my-pkg.v1")).toBe(true);
    expect(isSafeRegistrySlug("../etc")).toBe(false);
    expect(isSafeRegistrySlug("acme/tools")).toBe(false);
    expect(isSafeRegistrySlug("")).toBe(false);
    expect(localRegistryCandidates(
      { ownerSlug: "..", packageSlug: "x", versionSlug: "latest" },
      "/tmp/reg",
    )).toEqual([]);
  });

  it("loads YAML from ~/.knoxcoder/registry/owner/package.yaml", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "knox-reg-"));
    mkdirSync(path.join(dir, "acme"), { recursive: true });
    writeFileSync(path.join(dir, "acme", "tools.yaml"), "name: tools\n");
    const client = new RegistryClient(dir);
    await expect(
      client.getContent({
        ownerSlug: "acme",
        packageSlug: "tools",
        versionSlug: "latest",
      }),
    ).resolves.toBe("name: tools\n");
  });

  it("prefers a versioned file when the slug has a version", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "knox-reg-"));
    mkdirSync(path.join(dir, "acme"), { recursive: true });
    writeFileSync(path.join(dir, "acme", "tools.yaml"), "name: latest\n");
    writeFileSync(path.join(dir, "acme", "tools@1.2.yaml"), "name: pinned\n");
    const client = new RegistryClient(dir);
    await expect(
      client.getContent({
        ownerSlug: "acme",
        packageSlug: "tools",
        versionSlug: "1.2",
      }),
    ).resolves.toBe("name: pinned\n");
  });

  it("errors without fetching when the block is missing", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "knox-reg-"));
    const client = new RegistryClient(dir);
    await expect(
      client.getContent({
        ownerSlug: "acme",
        packageSlug: "missing",
        versionSlug: "latest",
      }),
    ).rejects.toThrow(/not found|Remote registries are not supported/);
  });
});
