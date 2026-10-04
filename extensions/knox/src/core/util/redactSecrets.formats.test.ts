import { describe, expect, it } from "vitest";

import { redactSecrets } from "./redactSecrets";

// Fake, test-only values assembled at runtime so scanners do not flag the file.
const j = (...p: string[]) => p.join("");
const CASES: Record<string, { text: string; secret: string }> = {
  "AWS access key": { text: `key ${j("AKIA", "IOSFODNN7EXAMPLE")}`, secret: j("AKIA", "IOSFODNN7EXAMPLE") },
  "AWS secret in env": {
    text: `AWS_SECRET_ACCESS_KEY=${j("wJalrXUtnFEMI", "/K7MDENG/bPxRfiCYEXAMPLEKEY")}`,
    secret: j("wJalrXUtnFEMI"),
  },
  "AWS session token": { text: `AWS_SESSION_TOKEN=${"Fw".repeat(30)}`, secret: "Fw".repeat(10) },
  "GCP API key": { text: `k=${j("AIza", "SyA-1234567890abcdefghijklmnopqrstu")}`, secret: j("AIza", "SyA-1234567890") },
  "GCP service account JSON": {
    text: `{"type":"service_account","private_key_id":"abc123abc123abc123","private_key":"-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBg\\n-----END PRIVATE KEY-----\\n"}`,
    secret: "MIIEvQIBADANBg",
  },
  "GCP OAuth access token": { text: `token ${j("ya29.", "a0AfH6SMBx-abcdefghijklmnopqrstuvwxyz0123456789")}`, secret: j("ya29.", "a0AfH6SMBx") },
  "GitHub PAT": { text: `${j("ghp_", "A".repeat(36))}`, secret: "AAAAAAAAAA" },
  "GitHub fine-grained": { text: j("github_pat_", "11ABCDEFG0abcdefghij_", "x".repeat(40)), secret: "xxxxxxxxxx" },
  "Stripe live secret": { text: j("sk_", "live_", "4eC39HqLyjWDarjtT1zdp7dc"), secret: "4eC39HqLyjWDarjtT1zdp7dc" },
  "Stripe restricted": { text: j("rk_", "live_", "4eC39HqLyjWDarjtT1zdp7dc"), secret: "4eC39HqLyjWDarjtT1zdp7dc" },
  "Stripe test secret": { text: j("sk_", "test_", "4eC39HqLyjWDarjtT1zdp7dc"), secret: "4eC39HqLyjWDarjtT1zdp7dc" },
  "Stripe webhook": { text: j("whsec_", "abcdefghijklmnopqrstuvwxyz012345"), secret: "abcdefghijklmnopqrstuvwxyz012345" },
  JWT: {
    text: j("eyJhbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", ".", "dBjftJeZ4CVPmB92K27uhbUJU1p1r"),
    secret: "dBjftJeZ4CVPmB92K27uhbUJU1p1r",
  },
  "OpenSSH private key": {
    text: "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----",
    secret: "b3BlbnNzaC1rZXktdjEAAAAA",
  },
  "Postgres URL": { text: "postgres://admin:s3cretpass@db.local:5432/x", secret: "s3cretpass" },
  "MongoDB SRV URL": { text: "mongodb+srv://user:p4ssw0rdXYZ@cluster0.mongodb.net/db", secret: "p4ssw0rdXYZ" },
  "Redis URL (empty user)": { text: "redis://:topsecretpw@cache:6379/0", secret: "topsecretpw" },
  "Authorization Bearer": { text: "Authorization: Bearer abcdefghijklmnop1234567890", secret: "abcdefghijklmnop1234567890" },
  "Authorization Basic": { text: "Authorization: Basic dXNlcjpwYXNzd29yZDEyMw==", secret: "dXNlcjpwYXNzd29yZDEyMw" },
  "Authorization Token scheme": { text: "Authorization: Token abcdefghijklmnop1234567890", secret: "abcdefghijklmnop1234567890" },
  "curl -H header": { text: `curl -H "Authorization: Bearer abcdefghijklmnop1234567890" https://x`, secret: "abcdefghijklmnop1234567890" },
  "x-api-key header": { text: "x-api-key: abcdefghijklmnop1234567890", secret: "abcdefghijklmnop1234567890" },
  "Slack token": { text: j("xoxb-", "123456789012-abcdefghijklmn"), secret: "123456789012" },
  "npm token": { text: j("npm_", "a".repeat(36)), secret: "aaaaaaaaaa" },
  "Knox/KnoxChat key env": { text: "KNOX_API_KEY=kc_live_abcdef1234567890", secret: "abcdef1234567890" },
  "OAuth refresh token JSON": { text: `{"refresh_token":"1//0gAbCdEfGhIjKlMnOpQrStUv"}`, secret: "0gAbCdEfGhIjKlMnOpQrStUv" },
  "Anthropic key": { text: j("sk-ant-", "api03-abcdefghijklmnopqrstuvwxyz"), secret: "abcdefghijklmnopqrstuvwxyz" },
};

describe("redactSecrets: common credential formats", () => {
  for (const [name, { text, secret }] of Object.entries(CASES)) {
    it(`redacts ${name}`, () => {
      const out = redactSecrets(`before ${text} after`);
      expect(out).not.toContain(secret);
      expect(out).toContain("before");
      expect(out).toContain("after");
    });
  }

  it("is idempotent", () => {
    for (const { text } of Object.values(CASES)) {
      const once = redactSecrets(text);
      expect(redactSecrets(once)).toBe(once);
    }
  });

  it("leaves ordinary code and prose alone", () => {
    const benign = [
      "const token = getToken();",
      "password: string;",
      "See https://example.com/docs/path?x=1 for details.",
      "git commit 0123456789abcdef0123456789abcdef01234567",
      "The authorization header is required.",
      "https://github.com/knoxchat/knoxcoder",
    ];
    for (const b of benign) {
      expect(redactSecrets(b)).toBe(b);
    }
  });

  it("stays linear on adversarial input", () => {
    const t0 = Date.now();
    redactSecrets("Bearer " + "a".repeat(200_000));
    redactSecrets("-----BEGIN PRIVATE KEY-----" + "A".repeat(200_000));
    redactSecrets("x://" + "a:".repeat(50_000));
    redactSecrets("API_KEY=" + "a".repeat(200_000));
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
