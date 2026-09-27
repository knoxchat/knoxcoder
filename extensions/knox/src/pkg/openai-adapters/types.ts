import * as z from "zod";

export const ClientCertificateOptionsSchema = z.object({
  cert: z.string(),
  key: z.string(),
  passphrase: z.string().optional(),
});

export const RequestOptionsSchema = z.object({
  timeout: z.number().optional(),
  verifySsl: z.boolean().optional(),
  caBundlePath: z.union([z.string(), z.array(z.string())]).optional(),
  proxy: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  extraBodyProperties: z.record(z.string(), z.unknown()).optional(),
  noProxy: z.array(z.string()).optional(),
  clientCertificate: z.lazy(() => ClientCertificateOptionsSchema).optional(),
});
export type RequestOptions = z.infer<typeof RequestOptionsSchema>;

// Base config objects
export const BaseConfig = z.object({
  provider: z.string(),
  requestOptions: RequestOptionsSchema.optional(),
});

export const BasePlusConfig = BaseConfig.extend({
  apiBase: z.string().optional(),
  apiKey: z.string().optional(),
});

// OpenAI and compatible
export const OpenAIConfigSchema = BasePlusConfig.extend({
  provider: z.union([
    z.literal("openai"),
    z.literal("knoxchat")
  ]),
});
export type OpenAIConfig = z.infer<typeof OpenAIConfigSchema>;

export const MockConfigSchema = BasePlusConfig.extend({
  provider: z.literal("mock"),
});
export type MockConfig = z.infer<typeof MockConfigSchema>;

export const AnthropicConfigSchema = OpenAIConfigSchema.extend({
  provider: z.literal("anthropic"),
  apiKey: z.string(),
});
export type AnthropicConfig = z.infer<typeof AnthropicConfigSchema>;

// Discriminated union
export const LLMConfigSchema = z.discriminatedUnion("provider", [
  OpenAIConfigSchema,
  AnthropicConfigSchema,
  MockConfigSchema,
]);
export type LLMConfig = z.infer<typeof LLMConfigSchema>;
