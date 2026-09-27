import { describe, expect, it } from "vitest";

import {
  decryptBrainExport,
  encryptBrainExport,
  isEncryptedBrainExport,
} from "./exportCrypto.js";

describe("brain export crypto", () => {
  it("round-trips plaintext through AES-GCM envelope", () => {
    const plaintext = JSON.stringify({
      version: 1,
      sessions: [],
      semantic: [{ id: 1, title: "secret fact" }],
    });
    const envelope = encryptBrainExport(plaintext, "test-password");
    expect(isEncryptedBrainExport(envelope)).toBe(true);
    expect(envelope.ciphertext).not.toContain("secret fact");
    const decrypted = decryptBrainExport(envelope, "test-password");
    expect(JSON.parse(decrypted).semantic[0].title).toBe("secret fact");
  });

  it("rejects wrong password", () => {
    const envelope = encryptBrainExport('{"version":1}', "correct-horse");
    expect(() => decryptBrainExport(envelope, "wrong")).toThrow(/Failed to decrypt/);
  });
});
