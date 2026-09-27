import { afterEach, describe, expect, it, vi } from "vitest";

import { IDE, IdeSettings } from "../index.js";
import { ConfigHandler } from "./ConfigHandler.js";

const ideSettings: IdeSettings = {};

function createStubIde(): IDE {
  return new Proxy({} as IDE, {
    get(_target, prop: string | symbol) {
      if (prop === "getWorkspaceDirs") {
        return async () => [] as string[];
      }
      if (prop === "fileExists") {
        return async () => false;
      }
      if (prop === "getIdeSettings") {
        return async () => ideSettings;
      }
      if (prop === "getIdeInfo") {
        return async () => ({
          ideType: "vscode" as const,
          name: "test",
          version: "0",
          remoteName: "",
          extensionVersion: "0",
        });
      }
      if (prop === "listDir") {
        return async () => [] as [string, number][];
      }
      if (prop === "readFile") {
        return async () => "";
      }
      if (prop === "getUniqueId") {
        return async () => "test-unique-id";
      }
      if (typeof prop === "string") {
        return async () => undefined;
      }
      return undefined;
    },
  });
}

describe("ConfigHandler local profiles", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reloadLocalProfiles never throws", async () => {
    const handler = new ConfigHandler(
      createStubIde(),
      Promise.resolve(ideSettings),
      async () => {},
    );

    // Wait for background init; failures are swallowed inside init().
    await handler.initializedPromise.catch(() => undefined);

    await expect(handler.reloadLocalProfiles()).resolves.toBeUndefined();
  });
});
