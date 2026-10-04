/**
 * Read GUI `config.yaml` defaults for the CLI (P1-4 config parity).
 * Does not create the file; missing yaml means the baked CLI default.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as YAML from "yaml";

export function configYamlPath(env: NodeJS.ProcessEnv = process.env): string {
  const root =
    env.KNOX_GLOBAL_DIR?.trim() || path.join(os.homedir(), ".knoxcoder");
  return path.join(root, "config.yaml");
}

/** First configured model id, if any. `--model` still wins. */
export function cliModelFromConfig(file = configYamlPath()): string | undefined {
  try {
    const doc = YAML.parse(fs.readFileSync(file, "utf8")) as {
      models?: Array<{ model?: unknown }>;
    } | null;
    for (const model of doc?.models ?? []) {
      if (typeof model?.model === "string" && model.model.trim()) {
        return model.model.trim();
      }
    }
  } catch {
    // missing or unreadable: CLI uses its baked default
  }
  return undefined;
}
