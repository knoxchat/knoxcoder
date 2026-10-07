import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { ChatMessage, KnoxSDK } from "../../index.js";
import ShareSlashCommand from "./share";

describe("/share", () => {
  it("redacts secrets in the exported transcript", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "knox-share-"));
    const written: Record<string, string> = {};
    try {
      const secret = ["ghp_", "A".repeat(36)].join("");
      const history: ChatMessage[] = [
        { role: "user", content: `token ${secret}` },
        { role: "assistant", content: "ok" },
        { role: "user", content: "/share" },
      ];
      const sdk = {
        ide: {
          getWorkspaceDirs: async () => ["file://" + dir],
          writeFile: async (uri: string, content: string) => {
            written[uri] = content;
          },
          openFile: async () => undefined,
        },
        history,
        params: { outputDir: dir },
      } as unknown as KnoxSDK;
      const lines: string[] = [];
      for await (const line of ShareSlashCommand.run(sdk)) {
        if (line) {
          lines.push(line);
        }
      }
      const body = Object.values(written)[0];
      expect(body).toBeDefined();
      expect(body).not.toContain(secret);
      expect(body).toContain("token");
      const joined = lines.join("\n");
      expect(joined).toMatch(/session|transcript|saved/i);
      expect(joined).toContain("knoxcoder://vscode.knox/session/import");
      expect(joined).toContain("path=");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
