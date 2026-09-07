import { z } from "zod";
import { requestOptionsSchema } from "../models.js";
import {
  chatFeedbackEventAllSchema,
  chatInteractionEventAllSchema,
  quickEditEventAllSchema,
  tokensGeneratedEventAllSchema,
} from "./events.js";
import { devDataSchemas } from "./versions.js";

export { devDataSchemas } from "./versions.js";
export {
  chatFeedbackEventAllSchema,
  chatInteractionEventAllSchema,
  editInteractionEventAllSchema,
  editOutcomeEventAllSchema,
  quickEditEventAllSchema,
  tokensGeneratedEventAllSchema,
} from "./events.js";

const dataLevel = z.union([z.literal("all"), z.literal("noCode")]);

export const dataSchema = z.object({
  name: z.string(),
  destination: z.string(),
  level: dataLevel.optional(),
  events: z.array(z.string()).optional(),
  requestOptions: requestOptionsSchema.optional(),
  apiKey: z.string().optional(),
});

export type DataDestination = z.infer<typeof dataSchema>;
export type DataLogLevel = z.infer<typeof dataLevel>;

// Schemas for data that the log function should have
// In order to build event bodies for ALL versions of an event
const devEventAllVersionDataSchemas = z.object({
  quickEdit: quickEditEventAllSchema,
  chatFeedback: chatFeedbackEventAllSchema,
  tokensGenerated: tokensGeneratedEventAllSchema,
  chatInteraction: chatInteractionEventAllSchema,
  // editInteraction: editInteractionEventAllSchema,
});

type DevEventDataSchemas = z.infer<typeof devEventAllVersionDataSchemas>;
export type DevEventName = keyof DevEventDataSchemas;
type DevEventAllVersionsSchema<T extends DevEventName> = DevEventDataSchemas[T];

export type DevDataLogEvent = {
  [K in DevEventName]: {
    name: K;
    data: Omit<
      DevEventAllVersionsSchema<K>,
      | "eventName"
      | "schema"
      | "timestamp"
      | "userId"
      | "userAgent"
      | "selectedProfileId"
    >;
  };
}[DevEventName];

export const allDevEventNames = Object.keys(
  devEventAllVersionDataSchemas.shape,
) as DevEventName[];
