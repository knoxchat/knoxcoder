import { z } from "zod";
import { completionOptionsSchema } from "../models.js";
import { baseDevDataAllSchema } from "./base.js";

// ── Chat Feedback ───────────────────────────────────────────────────────────

export const chatFeedbackEventAllSchema = baseDevDataAllSchema.extend({
  modelTitle: z.string(),
  completionOptions: z.object({}),
  prompt: z.string(),
  completion: z.string(),
  feedback: z.boolean().optional(),
  sessionId: z.string().uuid(),
});

// ── Chat Interaction ────────────────────────────────────────────────────────

export const chatInteractionEventAllSchema = baseDevDataAllSchema.extend({
  modelProvider: z.string(),
  modelTitle: z.string(),
  prompt: z.string(),
  completion: z.string(),
  sessionId: z.string(),
});

// ── Edit Interaction ────────────────────────────────────────────────────────

export const editInteractionEventAllSchema = baseDevDataAllSchema.extend({
  modelProvider: z.string(),
  modelTitle: z.string(),
  prompt: z.string(),
  completion: z.string(),
});

// ── Edit Outcome ────────────────────────────────────────────────────────────

export const editOutcomeEventAllSchema = baseDevDataAllSchema.extend({
  modelProvider: z.string(),
  modelTitle: z.string(),
  prompt: z.string(),
  completion: z.string(),
  previousCode: z.string(),
  newCode: z.string(),
  previousCodeLines: z.number(),
  newCodeLines: z.number(),
  lineChange: z.number(),
  accepted: z.boolean(),
});

// ── Quick Edit ──────────────────────────────────────────────────────────────

export const quickEditEventAllSchema = z.object({
  prompt: z.string(),
  path: z.string().optional(),
  label: z.string(),
  diffs: z
    .array(
      z.object({
        type: z.enum(["new", "old", "same"]),
        line: z.string(),
      }),
    )
    .optional(),
  model: z.string().optional(),
});

// ── Tokens Generated ────────────────────────────────────────────────────────

export const tokensGeneratedEventAllSchema = baseDevDataAllSchema.extend({
  model: z.string(),
  provider: z.string(),
  promptTokens: z.number(),
  generatedTokens: z.number(),
});
