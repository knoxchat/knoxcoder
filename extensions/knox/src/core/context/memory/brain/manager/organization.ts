/** Tags and collections. */

import { BrainStore } from "../BrainStore.js";
import type {
  TagInput,
  CollectionInput,
  AddToCollectionInput,
} from "../types.js";
import { emit } from "./events.js";

// ── Tags ───────────────────────────────────────────────────────────────────

export async function tag(input: TagInput): Promise<number> {
  const id = await BrainStore.addTag(input.memory_type, input.memory_id, input.tag);
  emit("tag:added", { id, memory_type: input.memory_type, memory_id: input.memory_id, tag: input.tag });
  return id;
}

export async function untag(input: TagInput): Promise<boolean> {
  const result = await BrainStore.removeTag(input.memory_type, input.memory_id, input.tag);
  if (result) emit("tag:removed", { memory_type: input.memory_type, memory_id: input.memory_id, tag: input.tag });
  return result;
}

export async function searchByTag(tag: string, memoryType?: string, limit?: number) {
  return BrainStore.searchByTag(tag, memoryType, limit);
}

// ── Collections ────────────────────────────────────────────────────────────

export async function createCollection(input: CollectionInput): Promise<number> {
  const id = await BrainStore.createCollection(input.name, input.description ?? "");
  emit("collection:created", { id, name: input.name });
  return id;
}

export async function listCollections(limit?: number) {
  return BrainStore.listCollections(limit);
}

export async function addToCollection(input: AddToCollectionInput): Promise<number> {
  const id = await BrainStore.addToCollection(input.collection_id, input.memory_type, input.memory_id);
  emit("collection:item_added", { id, collection_id: input.collection_id, memory_type: input.memory_type, memory_id: input.memory_id });
  return id;
}
