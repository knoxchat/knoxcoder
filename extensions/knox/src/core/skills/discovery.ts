/**
 * Remote skill discovery — fetches skill packs from a URL.
 *
 * The URL should serve an `index.json` with format:
 * ```json
 * {
 *   "skills": [
 *     {
 *       "name": "my-skill",
 *       "description": "...",
 *       "files": ["SKILL.md", "scripts/run.sh"],
 *       "sha256": "optional hex digest of SKILL.md (or pin overrides)"
 *     }
 *   ]
 * }
 * ```
 *
 * Each skill's files are downloaded relative to `<url>/<skill.name>/`.
 * Downloaded skills are cached under `~/.knox/cache/skills/`.
 * Optional `skills.pins` in config pins `name → sha256` and rejects mismatches.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { getKnoxGlobalPath } from "../util/paths";

export interface SkillIndexEntry {
  name: string;
  description: string;
  files: string[];
  /** Optional integrity hash for SKILL.md (hex sha256) */
  sha256?: string;
  version?: string;
}

interface SkillIndex {
  skills: SkillIndexEntry[];
}

export type PullSkillsOptions = {
  /** Config pins: skill name → expected sha256 of SKILL.md */
  pins?: Record<string, string>;
};

function getCacheDir(): string {
  const dir = path.join(getKnoxGlobalPath(), "cache", "skills");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function sha256Hex(content: string | Buffer): string {
  return crypto
    .createHash("sha256")
    .update(typeof content === "string" ? content : (content as Uint8Array))
    .digest("hex");
}

function expectedHash(
  skill: SkillIndexEntry,
  pins?: Record<string, string>,
): string | undefined {
  const pinned = pins?.[skill.name]?.trim().toLowerCase();
  if (pinned) {
    return pinned;
  }
  const fromIndex = skill.sha256?.trim().toLowerCase();
  return fromIndex || undefined;
}

function verifySkillMdHash(skillMdPath: string, expected: string): boolean {
  try {
    const content = fs.readFileSync(skillMdPath);
    return sha256Hex(content) === expected.toLowerCase();
  } catch {
    return false;
  }
}

async function downloadFile(
  url: string,
  dest: string,
  options?: { force?: boolean },
): Promise<boolean> {
  if (fs.existsSync(dest) && !options?.force) {
    return true;
  }
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[skills] Failed to download ${url}: ${response.status}`);
      return false;
    }
    const text = await response.text();
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(dest, text, "utf-8");
    return true;
  } catch (err) {
    console.error(`[skills] Failed to download ${url}:`, err);
    return false;
  }
}

/**
 * Pull skills from a remote index URL.
 * Returns local directory paths that contain a valid (and optionally pinned) SKILL.md.
 */
export async function pullSkillsFromUrl(
  url: string,
  options?: PullSkillsOptions,
): Promise<string[]> {
  const result: string[] = [];
  const base = url.endsWith("/") ? url : `${url}/`;
  const indexUrl = new URL("index.json", base).href;
  const cache = getCacheDir();
  const pins = options?.pins;

  let data: SkillIndex | undefined;
  try {
    const response = await fetch(indexUrl);
    if (!response.ok) {
      console.error(
        `[skills] Failed to fetch index: ${indexUrl} (${response.status})`,
      );
      return result;
    }
    data = (await response.json()) as SkillIndex;
  } catch (err) {
    console.error(`[skills] Failed to fetch index: ${indexUrl}`, err);
    return result;
  }

  if (!data?.skills || !Array.isArray(data.skills)) {
    console.warn(`[skills] Invalid index format: ${indexUrl}`);
    return result;
  }

  const validSkills = data.skills.filter(
    (s) => s?.name && Array.isArray(s.files),
  );

  await Promise.all(
    validSkills.map(async (skill) => {
      const root = path.join(cache, skill.name);
      const md = path.join(root, "SKILL.md");
      const hash = expectedHash(skill, pins);

      // Refresh cache when a pin/hash is known and the cached file mismatches
      const needsRefresh =
        !!hash && fs.existsSync(md) && !verifySkillMdHash(md, hash);

      await Promise.all(
        skill.files.map(async (file) => {
          const fileUrl = new URL(
            file,
            `${base.replace(/\/$/, "")}/${skill.name}/`,
          ).href;
          const dest = path.join(root, file);
          const force = needsRefresh && path.basename(file) === "SKILL.md";
          await downloadFile(fileUrl, dest, { force });
        }),
      );

      if (!fs.existsSync(md)) {
        return;
      }

      if (hash && !verifySkillMdHash(md, hash)) {
        console.error(
          `[skills] Integrity check failed for "${skill.name}" (expected sha256 ${hash}). Skipping.`,
        );
        try {
          fs.rmSync(root, { recursive: true, force: true });
        } catch {
          // ignore cleanup errors
        }
        return;
      }

      result.push(root);
    }),
  );

  return result;
}
