import z from "zod";

import {
  BrowserSerializedKnoxConfig,
  Config,
  KnoxConfig,
} from "..";
import { parsePolicyLines } from "../tools/toolPolicy";

export const sharedConfigSchema = z
  .object({
    // boolean fields in config.json
    disableSessionTitles: z.boolean(),

    // `experimental` in `KnoxConfig`
    promptPath: z.string(),
    /** Max Agent tool rounds per turn; 0 / unset = unlimited. */
    agentMaxSteps: z.number().int().min(0).max(1000),
    /** Identical tool+args repeats before a summary turn; 0 = disable. Default 3. */
    agentDoomLoopThreshold: z.number().int().min(0).max(20),
    /** Default maxFiles for builtin_view_subdirectory when the model omits it. */
    agentViewSubdirectoryMaxFiles: z.number().int().min(50).max(20000),
    /** Agent loop profile (HL-12). */
    agentProfile: z.enum(["default", "systems", "rust", "auto"]),
    /** Post-edit compile oracle command (HL-07). Empty = LSP diagnostics. */
    agentVerifyCommand: z.string(),
    agentVerifyMode: z.enum(["diagnostics", "command", "off"]),
    agentVerifyMaxIterations: z.number().int().min(1).max(20),
    /** User-edited path policy lines: `deny ~/.ssh/**` */
    agentPolicyPaths: z.string(),
    /** User-edited command policy lines: `ask git *` */
    agentPolicyCommands: z.string(),
    agentPolicyExternalDirectory: z.enum(["deny", "ask", "allow"]),
    agentPolicySandboxDestructive: z.boolean(),

    // `ui` in `KnoxConfig`
    showSessionTabs: z.boolean(),
    codeBlockToolbarPosition: z.enum(["top", "bottom"]),
    fontSize: z.number(),
    codeWrap: z.boolean(),
    displayRawMarkdown: z.boolean(),
    showChatScrollbar: z.boolean(),
  })
  .partial();

export type SharedConfigSchema = z.infer<typeof sharedConfigSchema>;

/** Single source of UI toggle defaults (settings form, chat chrome, etc.). */
export const DEFAULT_UI_SETTINGS = {
  showSessionTabs: false,
  codeWrap: false,
  showChatScrollbar: false,
  displayRawMarkdown: false,
  disableSessionTitles: false,
} as const;

// For security in case of damaged config file, try to salvage any security-related values
export function salvageSharedConfig(sharedConfig: object): SharedConfigSchema {
  const salvagedConfig: SharedConfigSchema = {};
  if ("disableSessionTitles" in sharedConfig) {
    const val = z.boolean().safeParse(sharedConfig.disableSessionTitles);
    if (val.success) {
      salvagedConfig.disableSessionTitles = val.data;
    }
  }
  return salvagedConfig;
}

export function modifyAnyConfigWithSharedConfig<
  T extends KnoxConfig | BrowserSerializedKnoxConfig | Config,
>(knoxConfig: T, sharedConfig: SharedConfigSchema): T {
  const configCopy = { ...knoxConfig };

  configCopy.ui = {
    ...configCopy.ui,
  };

  if (sharedConfig.codeBlockToolbarPosition !== undefined) {
    configCopy.ui.codeBlockToolbarPosition =
      sharedConfig.codeBlockToolbarPosition;
  }
  if (sharedConfig.fontSize !== undefined) {
    configCopy.ui.fontSize = sharedConfig.fontSize;
  }
  if (sharedConfig.codeWrap !== undefined) {
    configCopy.ui.codeWrap = sharedConfig.codeWrap;
  }
  if (sharedConfig.displayRawMarkdown !== undefined) {
    configCopy.ui.displayRawMarkdown = sharedConfig.displayRawMarkdown;
  }
  if (sharedConfig.showChatScrollbar !== undefined) {
    configCopy.ui.showChatScrollbar = sharedConfig.showChatScrollbar;
  }

  if (sharedConfig.disableSessionTitles !== undefined) {
    configCopy.disableSessionTitles = sharedConfig.disableSessionTitles;
  }

  if (sharedConfig.showSessionTabs !== undefined) {
    configCopy.ui.showSessionTabs = sharedConfig.showSessionTabs;
  }

  configCopy.experimental = {
    ...configCopy.experimental,
  };
  if (sharedConfig.promptPath !== undefined) {
    configCopy.experimental.promptPath = sharedConfig.promptPath;
  }
  if (sharedConfig.agentMaxSteps !== undefined) {
    configCopy.experimental.agentMaxSteps = sharedConfig.agentMaxSteps;
  }
  if (sharedConfig.agentDoomLoopThreshold !== undefined) {
    configCopy.experimental.agentDoomLoopThreshold =
      sharedConfig.agentDoomLoopThreshold;
  }
  if (sharedConfig.agentViewSubdirectoryMaxFiles !== undefined) {
    configCopy.experimental.agentViewSubdirectoryMaxFiles =
      sharedConfig.agentViewSubdirectoryMaxFiles;
  }
  if (sharedConfig.agentProfile !== undefined) {
    configCopy.experimental.agentProfile = sharedConfig.agentProfile;
  }
  if (sharedConfig.agentVerifyCommand !== undefined) {
    configCopy.experimental.agentVerifyCommand =
      sharedConfig.agentVerifyCommand;
  }
  if (sharedConfig.agentVerifyMode !== undefined) {
    configCopy.experimental.agentVerifyMode = sharedConfig.agentVerifyMode;
  }
  if (sharedConfig.agentVerifyMaxIterations !== undefined) {
    configCopy.experimental.agentVerifyMaxIterations =
      sharedConfig.agentVerifyMaxIterations;
  }

  const hasPolicyUpdate =
    sharedConfig.agentPolicyPaths !== undefined ||
    sharedConfig.agentPolicyCommands !== undefined ||
    sharedConfig.agentPolicyExternalDirectory !== undefined ||
    sharedConfig.agentPolicySandboxDestructive !== undefined;
  if (hasPolicyUpdate) {
    const current = configCopy.experimental.agentPolicy ?? {};
    configCopy.experimental.agentPolicy = {
      ...current,
      ...(sharedConfig.agentPolicyPaths !== undefined
        ? { paths: parsePolicyLines(sharedConfig.agentPolicyPaths) }
        : {}),
      ...(sharedConfig.agentPolicyCommands !== undefined
        ? { commands: parsePolicyLines(sharedConfig.agentPolicyCommands) }
        : {}),
      ...(sharedConfig.agentPolicyExternalDirectory !== undefined
        ? { externalDirectory: sharedConfig.agentPolicyExternalDirectory }
        : {}),
      ...(sharedConfig.agentPolicySandboxDestructive !== undefined
        ? { sandboxDestructive: sharedConfig.agentPolicySandboxDestructive }
        : {}),
    };
  }

  return configCopy;
}
