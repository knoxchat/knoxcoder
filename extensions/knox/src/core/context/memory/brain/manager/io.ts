/** Import/export and cross-session backlog search. */

import fs from "fs";
import path from "path";
import { BrainStore } from "../BrainStore.js";
import { getMemoryBrainPath } from "../../../../util/paths.js";
import {
  resolveProjectScope,
} from "../projectScope.js";
import type {
  MemoryExport,
  BacklogSearchInput,
} from "../types.js";
import { getActiveSessionId } from "./runtime.js";

// ── Import/Export ──────────────────────────────────────────────────────────

export async function exportMemories(): Promise<string> {
  const data = await BrainStore.exportAll();
  const exportPath = path.join(getMemoryBrainPath(), `brain-export-${Date.now()}.json`);
  fs.writeFileSync(exportPath, JSON.stringify(data, null, 2));
  return `Memories exported to: ${exportPath}\nSessions: ${data.sessions.length}, Semantic: ${data.semantic.length}, Episodic: ${data.episodic.length}, Entities: ${data.entities.length}, Patterns: ${data.patterns.length}, Procedures: ${data.procedures.length}`;
}

export async function importMemories(filePath: string): Promise<string> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Import file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const data: MemoryExport = JSON.parse(raw);
  if (!data.version) {
    throw new Error("Invalid export file: missing version field");
  }
  const result = await BrainStore.importData(data);
  const summary = Object.entries(result.imported)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  return `Import complete: ${summary}`;
}

// ── Cross-Session Backlog Search ───────────────────────────────────────────

/**
 * Search across ALL sessions for matching content.
 * Supports date range filtering, role filtering, and session ID scoping.
 * This is the "find back logs to remember" feature.
 */
export async function searchBacklogs(input: BacklogSearchInput) {
  let sessionIds = input.session_ids;
  if (!sessionIds) {
    const { sessionIds: scoped } = await resolveProjectScope(
      input.session_id ?? getActiveSessionId() ?? undefined,
      input.workspace_dir,
    );
    sessionIds = scoped;
  }

  return BrainStore.searchBacklogs(input.query, {
    limit: input.limit,
    session_ids: sessionIds,
    date_from: input.date_from,
    date_to: input.date_to,
    roles: input.roles,
    include_semantic: input.include_semantic,
    include_episodic: input.include_episodic,
  });
}
