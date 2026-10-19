/**
 * K-060: session-adjacent task-plan persistence.
 *
 * Sidecar `sessions/<id>.plan.json` so a Core restart still has remaining
 * steps. Writes only when the session JSON already exists — unit tests that
 * never create a session file stay in-memory and do not touch ~/.knoxcoder.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { writeFileAtomic } from "../util/atomicWrite";
import { withFileLockSync } from "../util/fileLock";
import { KNOX_GLOBAL_DIR_NAME } from "../util/globalDirName";

import type { PlanStepStatus, TaskPlan } from "./planStore";

const PLAN_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "in_progress",
  "done",
  "skipped",
]);

export interface PersistedPlanFile {
  cleared?: boolean;
  title?: string;
  steps?: TaskPlan["steps"];
  updatedAt?: number;
}

function sessionsDir(): string {
  const root =
    process.env.KNOX_GLOBAL_DIR ??
    path.join(os.homedir(), KNOX_GLOBAL_DIR_NAME);
  return path.join(root, "sessions");
}

/** Paths only — does not create ~/.knoxcoder. */
export function sessionPlanPaths(sessionId: string): {
  sessionFile: string;
  planFile: string;
} {
  const dir = sessionsDir();
  return {
    sessionFile: path.join(dir, `${sessionId}.json`),
    planFile: path.join(dir, `${sessionId}.plan.json`),
  };
}

export function isTaskPlan(value: unknown): value is TaskPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<TaskPlan>;
  if (typeof record.title !== "string" || !Array.isArray(record.steps)) {
    return false;
  }
  return record.steps.every(
    (step) =>
      step &&
      typeof step.id === "string" &&
      typeof step.title === "string" &&
      PLAN_STATUSES.has(step.status as PlanStepStatus),
  );
}

function readJson(file: string): unknown {
  try {
    if (!fs.existsSync(file)) {
      return undefined;
    }
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

export function canPersistPlan(sessionId: string): boolean {
  const key = sessionId.trim();
  if (!key || key === "default") {
    return false;
  }
  return fs.existsSync(sessionPlanPaths(key).sessionFile);
}

export function readPersistedPlan(sessionId: string): TaskPlan | undefined {
  const key = sessionId.trim();
  if (!key || key === "default") {
    return undefined;
  }
  const { planFile } = sessionPlanPaths(key);
  const raw = readJson(planFile) as PersistedPlanFile | undefined;
  if (!raw || raw.cleared === true) {
    return undefined;
  }
  if (!isTaskPlan(raw)) {
    return undefined;
  }
  return {
    title: raw.title,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
    steps: raw.steps.map((step) => ({ ...step })),
  };
}

export function writePersistedPlan(
  sessionId: string,
  plan: TaskPlan | null,
): void {
  if (!canPersistPlan(sessionId)) {
    return;
  }
  const { planFile } = sessionPlanPaths(sessionId.trim());
  try {
    withFileLockSync(`${planFile}.lock`, () => {
      if (!plan) {
        writeFileAtomic(
          planFile,
          JSON.stringify({ cleared: true, updatedAt: Date.now() }),
        );
        return;
      }
      const payload: PersistedPlanFile = {
        title: plan.title,
        steps: plan.steps.map((step) => ({ ...step })),
        updatedAt: plan.updatedAt,
      };
      writeFileAtomic(planFile, JSON.stringify(payload));
    });
  } catch {
    // Persistence must never break the turn.
  }
}

export function removePersistedPlan(sessionId: string): void {
  const key = sessionId.trim();
  if (!key) {
    return;
  }
  const { planFile } = sessionPlanPaths(key);
  try {
    if (fs.existsSync(planFile)) {
      fs.unlinkSync(planFile);
    }
    const lock = `${planFile}.lock`;
    if (fs.existsSync(lock)) {
      fs.unlinkSync(lock);
    }
  } catch {
    // Best-effort cleanup.
  }
}
