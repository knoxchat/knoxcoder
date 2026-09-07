import * as z from "zod";
import { dataSchema } from "./data/index.js";
import { modelSchema, partialModelSchema } from "./models.js";

export const contextSchema = z.object({
  provider: z.string(),
  params: z.any().optional(),
});

const promptSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  prompt: z.string(),
});


export const blockItemWrapperSchema = <T extends z.ZodObject<any>>(schema: T) =>
  z.object({
    uses: z.string(),
    with: z.record(z.string(), z.string()).optional(),
    override: schema.partial().optional(),
  });

export const blockOrSchema = <T extends z.ZodObject<any>>(schema: T) =>
  z.union([schema, blockItemWrapperSchema(schema)]);

const agentConfigYamlSchema = z
  .object({
    profile: z.enum(["default", "systems", "rust", "auto"]).optional(),
    maxSteps: z.number().int().min(0).max(1000).optional(),
    doomLoopThreshold: z.number().int().min(0).max(20).optional(),
    verify: z
      .object({
        mode: z.enum(["diagnostics", "command", "off"]).optional(),
        command: z.string().optional(),
        maxIterations: z.number().int().min(1).max(20).optional(),
      })
      .optional(),
    jobs: z
      .object({
        logDir: z.string().optional(),
        awaitTimeoutMs: z.number().int().min(1000).max(3_600_000).optional(),
      })
      .optional(),
  })
  .optional();

export const baseConfigYamlSchema = z.object({
  name: z.string(),
  version: z.string(),
  schema: z.string().optional(),
});

export const configYamlSchema = baseConfigYamlSchema.extend({
  models: z
    .array(
      z.union([
        modelSchema,
        z.object({
          uses: z.string(),
          with: z.record(z.string(), z.string()).optional(),
          override: partialModelSchema.optional(),
        }),
      ]),
    )
    .optional(),
  context: z.array(blockOrSchema(contextSchema)).optional(),
  data: z.array(blockOrSchema(dataSchema)).optional(),
  rules: z
    .array(
      z.union([
        z.string(),
        z.object({
          uses: z.string(),
          with: z.record(z.string(), z.string()).optional(),
        }),
      ]),
    )
    .optional(),
  prompts: z.array(blockOrSchema(promptSchema)).optional(),
  agent: agentConfigYamlSchema,
});

export type ConfigYaml = z.infer<typeof configYamlSchema>;

export const assistantUnrolledSchema = baseConfigYamlSchema.extend({
  models: z.array(modelSchema).optional(),
  context: z.array(contextSchema).optional(),
  data: z.array(dataSchema).optional(),
  rules: z.array(z.string()).optional(),
  prompts: z.array(promptSchema).optional(),
  agent: agentConfigYamlSchema,
});

export type AssistantUnrolled = z.infer<typeof assistantUnrolledSchema>;

export const blockSchema = baseConfigYamlSchema.and(
  z.union([
    z.object({ models: z.array(modelSchema).length(1) }),
    z.object({ context: z.array(contextSchema).length(1) }),
    z.object({ data: z.array(dataSchema).length(1) }),
    z.object({ rules: z.array(z.string()).length(1) }),
    z.object({ prompts: z.array(promptSchema).length(1) }),
  ]),
);

export type Block = z.infer<typeof blockSchema>;
