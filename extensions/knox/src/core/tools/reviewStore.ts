import * as fs from "fs";
import * as path from "path";
import { getKnoxGlobalPath } from "../util/paths";
import { StagedEdits, type StagedFile } from "./stagedEdits";

/**
 * K-026 persistence: review mode and its staged edits survive closing and
 * reopening the editor. One JSON file per session under `<global>/review/`,
 * plus `pref.json` holding the last choice, used by sessions never decided.
 */
interface StoredReview {
  enabled: boolean;
  files: Array<[string, StagedFile]>;
}

export interface StagedHolder {
  stagedReview: Map<string, StagedEdits>;
}

const dir = (): string => path.join(getKnoxGlobalPath(), "review");
const fileFor = (sessionId: string): string =>
  path.join(dir(), `${sessionId.replace(/[^\w.-]/g, "_")}.json`);

function writeJson(file: string, value: unknown): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  } catch {
    // persistence is best effort; review still works in memory
  }
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Last review-mode choice made by the user (default for sessions with no record). */
export function readReviewPreference(): boolean {
  return readJson<{ enabled?: boolean }>(path.join(dir(), "pref.json"))?.enabled === true;
}

export function writeReviewPreference(enabled: boolean): void {
  writeJson(path.join(dir(), "pref.json"), { enabled });
}

/** Write the session's current review state (enabled flag + staged files). */
export function persistReview(
  core: StagedHolder,
  sessionId: string,
  enabledOverride?: boolean,
): void {
  const staged = core.stagedReview.get(sessionId);
  const stored: StoredReview = {
    enabled: enabledOverride ?? staged !== undefined,
    files: staged ? [...staged.files] : [],
  };
  writeJson(fileFor(sessionId), stored);
}

function track(core: StagedHolder, sessionId: string, staged: StagedEdits): void {
  staged.onChange = () => persistReview(core, sessionId);
}

/** Create (or return) the session's staging area and keep it persisted. */
export function enableReview(core: StagedHolder, sessionId: string): StagedEdits {
  let staged = core.stagedReview.get(sessionId);
  if (!staged) {
    staged = new StagedEdits();
    core.stagedReview.set(sessionId, staged);
  }
  track(core, sessionId, staged);
  return staged;
}

/**
 * Load the session's saved review state into memory when it is not there yet.
 * Falls back to the last global choice for sessions that were never decided.
 */
export function ensureReviewLoaded(core: StagedHolder, sessionId: string): void {
  const existing = core.stagedReview.get(sessionId);
  if (existing) {
    track(core, sessionId, existing);
    return;
  }
  const stored = readJson<StoredReview>(fileFor(sessionId));
  if (!stored) {
    if (readReviewPreference()) {
      enableReview(core, sessionId);
      persistReview(core, sessionId);
    }
    return;
  }
  if (!stored.enabled) {
    return;
  }
  const staged = enableReview(core, sessionId);
  for (const [uri, file] of stored.files ?? []) {
    staged.files.set(uri, file);
  }
}
