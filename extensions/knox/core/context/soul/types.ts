export type SoulEventKind =
  | "tool_success"
  | "tool_denied"
  | "tool_error"
  | "restore"
  | "compaction"
  | "build:fail"
  | "build:pass"
  | "qemu:panic"
  | "bisect:step";

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
  metadata?: Record<string, unknown>;
}

export interface SoulToolContext {
  sessionId?: string;
  turnId?: string;
  /** Explore/review children may recall but not write memory. */
  readonlyMemory?: boolean;
}
