/** Cross-memory associations. */

import { BrainStore } from "../BrainStore.js";
import type {
  AssociateInput,
} from "../types.js";
import { emit } from "./events.js";
import { invalidateMemoryCaches } from "./helpers.js";

// ── Associations ───────────────────────────────────────────────────────────

/**
 * Create an association between two memories.
 */
export async function associate(input: AssociateInput): Promise<number> {
  const id = await BrainStore.createAssociation(input);
  invalidateMemoryCaches();
  emit("edge:added", { id, source: `${input.source_type}#${input.source_id}`, target: `${input.target_type}#${input.target_id}`, relationship: input.relationship });
  return id;
}
