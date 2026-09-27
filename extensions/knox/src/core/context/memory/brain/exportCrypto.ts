import crypto from "crypto";

import type { EncryptedBrainExport } from "./types.js";

const ENCRYPTED_VERSION = "knox-brain-encrypted-v1" as const;

export function isEncryptedBrainExport(data: unknown): data is EncryptedBrainExport {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  return (
    obj.version === ENCRYPTED_VERSION &&
    typeof obj.salt === "string" &&
    typeof obj.iv === "string" &&
    typeof obj.tag === "string" &&
    typeof obj.ciphertext === "string"
  );
}

export function encryptBrainExport(
  plaintextJson: string,
  password: string,
): EncryptedBrainExport {
  if (!password || password.length < 4) {
    throw new Error("Export password must be at least 4 characters");
  }
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt as Uint8Array, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key as Uint8Array, iv as Uint8Array);
  const encrypted = Buffer.concat([
    cipher.update(plaintextJson, "utf8") as Uint8Array,
    cipher.final() as Uint8Array,
  ]);
  const tag = cipher.getAuthTag();
  return {
    version: ENCRYPTED_VERSION,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
}

export function decryptBrainExport(
  envelope: EncryptedBrainExport,
  password: string,
): string {
  if (!password) {
    throw new Error("Password required to decrypt this brain export");
  }
  const salt = Buffer.from(envelope.salt, "base64");
  const key = crypto.scryptSync(password, salt as Uint8Array, 32);
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key as Uint8Array, iv as Uint8Array);
  decipher.setAuthTag(tag as Uint8Array);
  try {
    return Buffer.concat([
      decipher.update(ciphertext as Uint8Array) as Uint8Array,
      decipher.final() as Uint8Array,
    ]).toString("utf8");
  } catch {
    throw new Error("Failed to decrypt brain export — wrong password or corrupt file");
  }
}
