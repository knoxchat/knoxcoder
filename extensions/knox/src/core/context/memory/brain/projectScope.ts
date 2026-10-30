/**
 * Project scope helpers — local project_id = hash(workspace_directory).
 * IMP-25: filter retrieval to current workspace when memory_scope is "project".
 */

import crypto from "crypto";

import { BrainStore } from "./BrainStore.js";
import { filterValidAt, isValidAt, type ValidityBounds } from "./entityResolution.js";
import { getMemoryConfig } from "./memoryConfigAccess.js";
import type { EpisodicMemory, MemoryScope, SemanticMemory } from "./types.js";

/** Stable local project identifier from workspace root path. */
export function hashProjectId(workspaceDir: string): string {
  if (!workspaceDir) return "";
  return crypto.createHash("sha256").update(workspaceDir).digest("hex").slice(0, 32);
}

export interface ProjectScopeResolution {
  /** undefined = global mode (no filter); [] = project mode but unknown project; else allowed session IDs */
  sessionIds: string[] | undefined;
  projectId: string | null;
}

/**
 * Resolve allowed session IDs for the active project.
 * Uses session row first, then workspace directory hash.
 */
export async function resolveProjectScope(
  sessionId?: string,
  workspaceDir?: string,
): Promise<ProjectScopeResolution> {
  const config = getMemoryConfig();
  if (config.memory_scope !== "project") {
    return { sessionIds: undefined, projectId: null };
  }

  let projectId = "";
  if (sessionId) {
    const session = await BrainStore.getSession(sessionId);
    if (session) {
      projectId = session.project_id || hashProjectId(session.workspace_directory);
    }
  }
  if (!projectId && workspaceDir) {
    projectId = hashProjectId(workspaceDir);
  }
  if (!projectId) {
    return { sessionIds: [], projectId: null };
  }

  const sessionIds = await BrainStore.listSessionIdsByProject(projectId);
  if (sessionId && !sessionIds.includes(sessionId)) {
    sessionIds.push(sessionId);
  }
  return { sessionIds, projectId };
}

/** @deprecated Prefer resolveProjectScope — returns sessionIds only. */
export async function getProjectSessionIds(
  sessionId: string | undefined,
  workspaceDir?: string,
): Promise<string[] | undefined> {
  const { sessionIds } = await resolveProjectScope(sessionId, workspaceDir);
  return sessionIds;
}

export function shouldApplyProjectScope(scope?: MemoryScope): boolean {
  return (scope ?? getMemoryConfig().memory_scope) === "project";
}

export function filterSemanticByProjectScope(
  memories: SemanticMemory[],
  projectSessionIds: string[] | undefined,
): SemanticMemory[] {
  if (projectSessionIds === undefined) return memories;
  if (projectSessionIds.length === 0) return [];
  const allowed = new Set(projectSessionIds);
  return memories.filter(
    (m) => Boolean(m.source_session_id && allowed.has(m.source_session_id)),
  );
}

export function filterEpisodicByProjectScope(
  memories: EpisodicMemory[],
  projectSessionIds: string[] | undefined,
): EpisodicMemory[] {
  if (projectSessionIds === undefined) return memories;
  if (projectSessionIds.length === 0) return [];
  const allowed = new Set(projectSessionIds);
  return memories.filter((e) => allowed.has(e.session_id));
}

export interface QueryScopeOptions {
  projectSessionIds?: string[];
  queryTime?: Date | string | number;
  supersededIds?: Iterable<number>;
}

/** MEM-26: facts valid at query time. Legacy NULL bounds stay in Ω(q). */
export function filterByValidity<T extends ValidityBounds>(
  rows: T[],
  queryTime?: Date | string | number,
): T[] {
  return filterValidAt(rows, queryTime);
}

/**
 * Ω(q) over semantic rows: project scope ∩ valid-at-query-time ∩ not superseded.
 * Old superseded rows stay queryable by id; they are not in default retrieve.
 */
export function filterSemanticByQueryScope(
  memories: SemanticMemory[],
  options: QueryScopeOptions = {},
): SemanticMemory[] {
  const superseded = options.supersededIds ? new Set(options.supersededIds) : undefined;
  const valid = memories.filter((memory) => {
    if (!isValidAt(memory, options.queryTime)) return false;
    if (superseded?.has(memory.id)) return false;
    return true;
  });
  return filterSemanticByProjectScope(valid, options.projectSessionIds);
}

export function filterEpisodicByQueryScope(
  memories: EpisodicMemory[],
  options: QueryScopeOptions = {},
): EpisodicMemory[] {
  const valid = memories.filter((memory) => isValidAt(memory, options.queryTime));
  return filterEpisodicByProjectScope(valid, options.projectSessionIds);
}
