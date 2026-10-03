import { describe, expect, it } from "vitest";

import { InputSanitizer } from "../context/memory/brain/InputSanitizer";
import { isToolAutoApproved } from "../agent/permissions";
import { executeToolWithMiddleware } from "../tools/middleware";
import { createKnoxLogger } from "./knoxLog";
import {
  containsSecret,
  isSensitiveSecretFile,
  redactSecrets,
} from "./redactSecrets";

// Fake, test-only values.
const FAKE = {
  openai: "sk-proj-abcdefghijklmnopqrstuvwxyz123456",
  anthropic: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
  gh: "ghp_" + "a".repeat(36),
  aws: "AKIAABCDEFGHIJKLMNOP",
  bearer: "Bearer abcdefghijklmnop1234567890",
  pem: "-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\n-----END RSA PRIVATE KEY-----",
};

describe("redactSecrets", () => {
  it("redacts known token shapes, PEM blocks and bearer headers", () => {
    for (const v of Object.values(FAKE)) {
      const out = redactSecrets(`before ${v} after`);
      expect(out).not.toContain(v.split(" ").pop()!.slice(-12));
      expect(out).toContain("REDACTED");
    }
  });

  it("redacts .env style and JSON values by key name", () => {
    const out = redactSecrets(
      'DB_PASSWORD=hunter2hunter2\nexport API_KEY=abcd1234efgh\n{"client_secret": "zzzzzzzz1"}',
    );
    expect(out).not.toMatch(/hunter2|abcd1234|zzzzzzzz1/);
  });

  it("redacts URL credentials but keeps the host", () => {
    const out = redactSecrets("postgres://admin:s3cretpass@db.local:5432/x");
    expect(out).toContain("db.local");
    expect(out).not.toContain("s3cretpass");
  });

  it("leaves ordinary code and prose untouched", () => {
    const code =
      "const token = getToken();\nif (password.length > 8) { return key; }\nSee the README.";
    expect(redactSecrets(code)).toBe(code);
    expect(containsSecret(code)).toBe(false);
  });

  it("flags sensitive files but not templates", () => {
    expect(isSensitiveSecretFile("/a/.env")).toBe(true);
    expect(isSensitiveSecretFile("/a/.env.local")).toBe(true);
    expect(isSensitiveSecretFile("/a/key.pem")).toBe(true);
    expect(isSensitiveSecretFile("/home/u/.ssh/id_rsa")).toBe(true);
    expect(isSensitiveSecretFile("/a/.env.example")).toBe(false);
    expect(isSensitiveSecretFile("/home/u/.ssh/id_rsa.pub")).toBe(false);
    expect(isSensitiveSecretFile("/a/src/environment.ts")).toBe(false);
  });
});

describe("secret hygiene across sinks", () => {
  it("tool output is redacted by the middleware", async () => {
    const tool: any = {
      uri: "builtin_read_file",
      function: {
        name: "builtin_read_file",
        parameters: { type: "object", properties: {} },
      },
    };
    const out = await executeToolWithMiddleware(
      async () => [
        { name: "f", description: "d", content: `KEY ${FAKE.openai}` },
      ],
      tool,
      {},
      {} as any,
      { validateArgs: false, retry: false, logging: false },
    );
    expect(out[0].content).not.toContain(FAKE.openai);
  });

  it("memory sanitizer redacts every occurrence", () => {
    const r = InputSanitizer.scan(`a ${FAKE.gh} b ${FAKE.gh} c`);
    expect(r.cleaned).not.toContain(FAKE.gh);
  });

  it("logger redacts message and args", () => {
    const lines: unknown[][] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => lines.push(a);
    try {
      createKnoxLogger("t").warn(`oops ${FAKE.anthropic}`, {
        header: FAKE.bearer,
      });
    } finally {
      console.warn = orig;
    }
    expect(JSON.stringify(lines)).not.toMatch(/abcdefghijklmnopqrstuvwxyz|1234567890/);
  });

  it("reading .env needs approval even in Auto; templates do not", () => {
    const base = {
      toolName: "builtin_read_file",
      toolSettings: {},
      permissionMode: "fullAuto" as const,
      workspaceDirs: ["/ws"],
    };
    expect(
      isToolAutoApproved({ ...base, args: { filepath: "/ws/.env" } }),
    ).toBe(false);
    expect(
      isToolAutoApproved({ ...base, args: { filepath: "/ws/.env.example" } }),
    ).toBe(true);
  });
});
