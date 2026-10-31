export type SoulEventKind =
  | "tool_success"
  | "tool_denied"
  | "tool_error"
  | "restore"
  | "checkpoint"
  | "compaction"
  | "build:fail"
  | "build:pass"
  | "qemu:panic"
  | "bisect:step"
  | "user_correction";

import type { SoulOracle } from "./oracleVerdict.js";

export type { SoulOracle, SoulOracleKind } from "./oracleVerdict.js";

export interface SoulEvent {
  sessionId: string;
  kind: SoulEventKind;
  toolName?: string;
  files: string[];
  workspaceCheckpointId?: string;
  memoryCheckpointId?: number;
  ok: boolean;
  policy?: "allow" | "ask" | "deny";
  summary: string;
  /** Structured check result (MC-13). Absent means "not verified", never "passed". */
  oracle?: SoulOracle;
  metadata?: Record<string, unknown>;
}

export interface SoulToolContext {
  sessionId?: string;
  turnId?: string;
  /** Explore/review children may recall but not write memory. */
  readonlyMemory?: boolean;
}
