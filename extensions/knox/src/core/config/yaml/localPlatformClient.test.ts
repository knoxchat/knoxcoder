import { describe, expect, it } from "vitest";
import { SecretType } from "knoxdev-package/config-yaml";

import { LocalPlatformClient } from "./loadYaml";

describe("LocalPlatformClient.resolveFQSNs", () => {
  it("returns empty array for no FQSNs", async () => {
    const client = new LocalPlatformClient();
    await expect(client.resolveFQSNs([])).resolves.toEqual([]);
  });

  it("resolves secrets from process.env by name", async () => {
    const secretName = "KNOX_TEST_LOCAL_SECRET_" + Date.now();
    process.env[secretName] = "from-env";
    try {
      const client = new LocalPlatformClient();
      const results = await client.resolveFQSNs([
        { packageSlugs: [], secretName },
      ]);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        found: true,
        value: "from-env",
        secretLocation: {
          secretType: SecretType.User,
          userSlug: "local",
          secretName,
        },
      });
    } finally {
      delete process.env[secretName];
    }
  });

  it("returns explicit NotFound when secret is missing (not undefined)", async () => {
    const secretName = "KNOX_MISSING_SECRET_THAT_SHOULD_NOT_EXIST";
    delete process.env[secretName];
    const client = new LocalPlatformClient();
    const results = await client.resolveFQSNs([
      { packageSlugs: [], secretName },
    ]);
    expect(results[0]).toEqual({
      found: false,
      fqsn: { packageSlugs: [], secretName },
      secretLocation: {
        secretType: SecretType.NotFound,
        secretName,
      },
    });
    expect(results[0]).not.toBeUndefined();
  });
});
