import { z } from "zod";

import {
  chatFeedbackEventAllSchema,
  chatInteractionEventAllSchema,
  editInteractionEventAllSchema,
  editOutcomeEventAllSchema,
  quickEditEventAllSchema,
  tokensGeneratedEventAllSchema,
} from "./events.js";

// ── Helper ──────────────────────────────────────────────────────────────────

function withLevels(
  allSchema: z.ZodObject<any>,
  pickFields: Record<string, true>,
  codeFields: string[],
) {
  const picked: z.ZodObject<any> = (allSchema as any).pick(pickFields);
  const omitMap = Object.fromEntries(
    codeFields.map((f) => [f, true as const]),
  );
  const noCode: z.ZodObject<any> = (picked as any).omit(omitMap);
  return { all: picked, noCode };
}

// Base fields included in event payloads
const baseFields = {
  timestamp: true,
  userId: true,
  userAgent: true,
  selectedProfileId: true,
  eventName: true,
} as const;

// ── Event schemas by level ──────────────────────────────────────────────────

const chatFeedback = withLevels(
  chatFeedbackEventAllSchema,
  {
    ...baseFields,
    prompt: true,
    completion: true,
    modelTitle: true,
    feedback: true,
    sessionId: true,
  },
  ["prompt", "completion"],
);

const chatInteraction = withLevels(
  chatInteractionEventAllSchema,
  {
    ...baseFields,
    prompt: true,
    completion: true,
    modelTitle: true,
    modelProvider: true,
    sessionId: true,
  },
  ["prompt", "completion"],
);

const editInteraction = withLevels(
  editInteractionEventAllSchema,
  {
    ...baseFields,
    prompt: true,
    completion: true,
    modelTitle: true,
    modelProvider: true,
  },
  ["prompt", "completion"],
);

const editOutcome = withLevels(
  editOutcomeEventAllSchema,
  {
    ...baseFields,
    prompt: true,
    completion: true,
    modelTitle: true,
    modelProvider: true,
    accepted: true,
  },
  ["prompt", "completion"],
);

const quickEdit = withLevels(
  quickEditEventAllSchema,
  {
    prompt: true,
    path: true,
    label: true,
    diffs: true,
    model: true,
  },
  ["prompt", "path", "diffs"],
);

const tokensGenerated = withLevels(
  tokensGeneratedEventAllSchema,
  {
    ...baseFields,
    model: true,
    provider: true,
    promptTokens: true,
    generatedTokens: true,
  },
  [],
);

// ── Unified schema map ──────────────────────────────────────────────────────

export const devDataSchemas = {
  all: {
    quickEdit: quickEdit.all,
    chatFeedback: chatFeedback.all,
    tokensGenerated: tokensGenerated.all,
    chatInteraction: chatInteraction.all,
    // editInteraction: editInteraction.all,
    // editOutcome: editOutcome.all,
  },
  noCode: {
    quickEdit: quickEdit.noCode,
    chatFeedback: chatFeedback.noCode,
    tokensGenerated: tokensGenerated.noCode,
    chatInteraction: chatInteraction.noCode,
    // editInteraction: editInteraction.noCode,
    // editOutcome: editOutcome.noCode,
  },
};
