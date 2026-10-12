import { BrainStore } from "../BrainStore.js";
import type { BrainSession } from "../types.js";

// ══════════════════════════════════════════════════════════════════════════════
// 22. Related Sessions Discovery
// ══════════════════════════════════════════════════════════════════════════════

export interface RelatedSession {
  session: BrainSession;
  shared_entities: string[];
  shared_topics: string[];
  shared_keywords: string[];
  relevance_score: number;
}

export class SessionDiscovery {
  /**
   * Find sessions related to a given session by shared entities, topics,
   * keywords, and semantic connections.
   */
  static async findRelatedSessions(
    sessionId: string,
    limit: number = 10,
  ): Promise<RelatedSession[]> {
    const db = await BrainStore.get();

    // 1. Get entities mentioned in this session's semantic memories
    const sessionEntities = await db.all(
      `SELECT DISTINCT e.name FROM brain_entities e
       INNER JOIN brain_semantic s ON s.source_session_id = ?
       WHERE LOWER(s.content) LIKE '%' || LOWER(e.name) || '%'
         OR LOWER(s.title) LIKE '%' || LOWER(e.name) || '%'`,
      [sessionId],
    );
    const entityNames = sessionEntities.map((r: any) => r.name as string);

    // 2. Get topics for this session
    const topics = await BrainStore.getSessionTopics(sessionId);
    const topicKeywords = topics.flatMap((t) =>
      t.keywords.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean),
    );
    const topicNames = topics.map((t) => t.topic.toLowerCase());

    // 3. Get keywords from this session's semantic memories
    const sessionSemantics = await db.all(
      `SELECT keywords FROM brain_semantic WHERE source_session_id = ? AND keywords != ''`,
      [sessionId],
    );
    const semKeywords = sessionSemantics.flatMap((r: any) =>
      (r.keywords as string).split(",").map((k) => k.trim().toLowerCase()).filter(Boolean),
    );

    // Combine all signals
    const allKeywords = new Set([...topicKeywords, ...semKeywords]);

    // 4. Get all other sessions
    const otherSessions = await db.all(
      `SELECT * FROM brain_sessions WHERE id != ? ORDER BY updated_at DESC LIMIT 100`,
      [sessionId],
    );

    const candidates: RelatedSession[] = [];

    for (const sess of otherSessions) {
      const s = sess as any;
      const sharedEntities: string[] = [];
      const sharedTopics: string[] = [];
      const sharedKeywords: string[] = [];
      let score = 0;

      // Check entity overlap via semantic memories
      if (entityNames.length > 0) {
        const otherSemantics = await db.all(
          `SELECT title, content FROM brain_semantic WHERE source_session_id = ?`,
          [s.id],
        );
        for (const entity of entityNames) {
          const lower = entity.toLowerCase();
          for (const sem of otherSemantics) {
            const text = `${(sem as any).title} ${(sem as any).content}`.toLowerCase();
            if (text.includes(lower)) {
              sharedEntities.push(entity);
              break;
            }
          }
        }
        score += sharedEntities.length * 3; // Entity matches weigh heavily
      }

      // Check topic overlap
      const otherTopics = await BrainStore.getSessionTopics(s.id);
      for (const ot of otherTopics) {
        const otName = ot.topic.toLowerCase();
        if (topicNames.includes(otName)) {
          sharedTopics.push(ot.topic);
          score += 2;
        }
        // Check keyword overlap in topics
        const otKeywords = ot.keywords.split(",").map((k: string) => k.trim().toLowerCase());
        for (const kw of otKeywords) {
          if (kw && allKeywords.has(kw)) {
            sharedKeywords.push(kw);
            score += 1;
          }
        }
      }

      // Check keyword overlap in semantic memories
      const otherKw = await db.all(
        `SELECT keywords FROM brain_semantic WHERE source_session_id = ? AND keywords != ''`,
        [s.id],
      );
      for (const row of otherKw) {
        const kws = (row as any).keywords.split(",").map((k: string) => k.trim().toLowerCase());
        for (const kw of kws) {
          if (kw && allKeywords.has(kw) && !sharedKeywords.includes(kw)) {
            sharedKeywords.push(kw);
            score += 0.5;
          }
        }
      }

      // Workspace bonus: same workspace = +1
      if (s.workspace_directory && s.workspace_directory === (await db.get(
        `SELECT workspace_directory FROM brain_sessions WHERE id = ?`, [sessionId],
      ) as any)?.workspace_directory) {
        score += 1;
      }

      if (score > 0) {
        candidates.push({
          session: {
            id: s.id,
            title: s.title,
            workspace_directory: s.workspace_directory,
            project_id: s.project_id ?? "",
            created_at: s.created_at,
            updated_at: s.updated_at,
            message_count: s.message_count,
            summary: s.summary,
            is_active: !!s.is_active,
          },
          shared_entities: [...new Set(sharedEntities)],
          shared_topics: [...new Set(sharedTopics)],
          shared_keywords: [...new Set(sharedKeywords)].slice(0, 20),
          relevance_score: score,
        });
      }
    }

    // Sort by relevance and limit
    candidates.sort((a, b) => b.relevance_score - a.relevance_score);
    return candidates.slice(0, limit);
  }
}
