import { z } from "zod";

export const clientCertificateOptionsSchema = z.object({
  cert: z.string(),
  key: z.string(),
  passphrase: z.string().optional(),
});
export type ClientCertificateOptions = z.infer<
  typeof clientCertificateOptionsSchema
>;

export const requestOptionsSchema = z.object({
  timeout: z.number().optional(),
  verifySsl: z.boolean().optional(),
  caBundlePath: z.union([z.string(), z.array(z.string())]).optional(),
  proxy: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  extraBodyProperties: z.record(z.string(), z.any()).optional(),
  noProxy: z.array(z.string()).optional(),
  clientCertificate: clientCertificateOptionsSchema.optional(),
});
export type RequestOptions = z.infer<typeof requestOptionsSchema>;
export const modelRolesSchema = z.enum([
  "chat",
  "edit",
  "apply",
  "summarize",
  "viewRead",
  "realTimeSearch",
]);
export type ModelRole = z.infer<typeof modelRolesSchema>;

export const modelCapabilitySchema = z.union([
  z.literal("tool_use"),
  z.literal("image_input"),
  z.literal("image_output"),
  z.literal("reasoning"),
  z.literal("web_search"),
]);
export type ModelCapability = z.infer<typeof modelCapabilitySchema>;

export const completionOptionsSchema = z.object({
  contextLength: z.number().optional(),
  maxTokens: z.number().optional(),
  temperature: z.number().optional(),
  topP: z.number().optional(),
  topK: z.number().optional(),
  stop: z.array(z.string()).optional(),
  n: z.number().optional(),
});
export type CompletionOptions = z.infer<typeof completionOptionsSchema>;


const promptTemplatesSchema = z.object({
  apply: z.string().optional(),
  edit: z.string().optional(),
});
export type PromptTemplates = z.infer<typeof promptTemplatesSchema>;

const baseModelFields = {
  name: z.string(),
  model: z.string(),
  apiKey: z.string().optional(),
  apiBase: z.string().optional(),
  roles: modelRolesSchema.array().optional(),
  capabilities: modelCapabilitySchema.array().optional(),
  defaultCompletionOptions: completionOptionsSchema.optional(),
  requestOptions: requestOptionsSchema.optional(),
  promptTemplates: promptTemplatesSchema.optional(),
  env: z
    .record(z.string(), z.union([z.string(), z.boolean(), z.number()]))
    .optional(),
};

export const modelSchema = z.object({
    ...baseModelFields,
  provider: z.string(),
});

export const partialModelSchema = z
  .object({
    ...baseModelFields,
    provider: z.string(),
  })
  .partial();
export type ModelConfig = z.infer<typeof modelSchema>;
