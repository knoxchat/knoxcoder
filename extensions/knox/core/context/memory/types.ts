/** Types for the persistent project memory system. */

export interface MemoryItem {
  id: number;
  /** Category: convention, fix-pattern, project-fact, user-note */
  category: MemoryCategory;
  /** Short title / key */
  title: string;
  /** Full content / description */
  content: string;
  /** Source that generated this memory (e.g., "auto-extract", "user", "fix-pattern") */
  source: string;
  /** Relevance score used for retrieval ranking (0-1) */
  relevanceScore: number;
  /** Comma-separated keywords for text search */
  keywords: string;
  /** Number of times this memory was retrieved */
  retrievalCount: number;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last access */
  lastAccessedAt: string;
  /** ISO timestamp of expiry (null = never) */
  expiresAt: string | null;
}

export type MemoryCategory =
  | "convention"
  | "fix-pattern"
  | "project-fact"
  | "user-note";

export interface MemoryQuery {
  /** Free-text search query */
  query: string;
  /** Filter by category */
  category?: MemoryCategory;
  /** Maximum results to return */
  limit?: number;
}

export interface MemoryCreateInput {
  category: MemoryCategory;
  title: string;
  content: string;
  source: string;
  keywords?: string;
  relevanceScore?: number;
  /** TTL in days — null for permanent */
  ttlDays?: number | null;
}
