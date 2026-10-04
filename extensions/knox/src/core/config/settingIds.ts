/**
 * KN-382: frozen VS Code setting and keybinding ids.
 *
 * These strings stay in `extensions/knox/package.json` so Settings Sync and
 * user keybindings survive the move off `./knox`. Do not rename.
 */

export const KNOX_SETTINGS_SECTION = "knoxchat";
export const KNOX_CHECKPOINTS_SECTION = "knox.checkpoints";

export const KNOX_CHAT_SETTING_IDS = [
  "knoxchat.showInlineTip",
  "knoxchat.enableInlineCompletions",
  "knoxchat.inlineCompletionModel",
  "knoxchat.disableQuickFix",
  "knoxchat.enableQuickActions",
  "knoxchat.enablePostEditVerification",
  "knoxchat.agentProfile",
  "knoxchat.jev.enabled",
  "knoxchat.jev.showStatusBar",
  "knoxchat.memoryBrain.maxBytes",
  "knoxchat.memoryBrain.enabled",
  "knoxchat.memoryBrain.workspaceEnabled",
  "knoxchat.networkMode",
  "knoxchat.networkAllowlist",
  "knoxchat.compatInstructions",
  "knoxchat.fallbackModel",
  "knoxchat.deferTools",
  "knoxchat.verifyCommand",
  "knoxchat.verifyMode",
  "knoxchat.verifyMaxIterations",
  "knoxchat.enableShadowPreview",
  "knoxchat.shadowPreviewLargeFiles",
] as const;

export const KNOX_CHECKPOINT_SETTING_IDS = [
  "knox.checkpoints.maxCheckpoints",
  "knox.checkpoints.retentionDays",
  "knox.checkpoints.maxStorageBytes",
  "knox.checkpoints.maxFilesPerCheckpoint",
  "knox.checkpoints.maxFileSizeBytes",
  "knox.checkpoints.captureBinaryFiles",
  "knox.checkpoints.enableCompression",
  "knox.checkpoints.encryptAtRest",
  "knox.checkpoints.trackedExtensions",
  "knox.checkpoints.autoCleanup",
  "knox.checkpoints.cleanupIntervalHours",
  "knox.checkpoints.enableAutoCheckpoints",
  "knox.checkpoints.auto.enabled",
  "knox.checkpoints.auto.minIntervalMs",
  "knox.checkpoints.auto.maxIntervalMs",
  "knox.checkpoints.auto.fileChangeThreshold",
  "knox.checkpoints.auto.checkpointAfterAI",
  "knox.checkpoints.auto.checkpointBeforeRisky",
  "knox.checkpoints.auto.maxUndoStack",
  "knox.checkpoints.auto.showNotifications",
  "knox.checkpoints.auto.debounceMs",
  "knox.checkpoints.smart.enabled",
  "knox.checkpoints.smart.agentModeOnly",
  "knox.checkpoints.smart.maxTrackedFiles",
  "knox.checkpoints.smart.maxMemoryUsageMB",
  "knox.checkpoints.smart.maxCheckpoints",
  "knox.checkpoints.smart.maxFileSizeKB",
  "knox.checkpoints.smart.verboseLogging",
  "knox.checkpoints.smart.enableMetrics",
  "knox.checkpoints.inlineDiff.enabled",
  "knox.checkpoints.inlineDiff.showLineDecorations",
  "knox.checkpoints.inlineDiff.showGutterIcons",
  "knox.checkpoints.inlineDiff.showHoverPreviews",
  "knox.checkpoints.inlineDiff.showCodeLens",
  "knox.checkpoints.inlineDiff.highlightWordChanges",
] as const;

export const KNOX_SETTING_IDS = [
  ...KNOX_CHAT_SETTING_IDS,
  ...KNOX_CHECKPOINT_SETTING_IDS,
] as const;

/** Contributed keybindings whose command ids must stay for user keymap sync. */
export const KNOX_SYNC_KEYBINDING_COMMANDS = [
  "knoxchat.focusKnoxInput",
  "knoxchat.focusKnoxInputWithoutClear",
  "knoxchat.acceptDiff",
  "knoxchat.rejectDiff",
  "knoxchat.acceptVerticalDiffBlock",
  "knoxchat.rejectVerticalDiffBlock",
  "knoxchat.focusEdit",
  "knoxchat.focusEditWithoutClear",
  "knoxchat.exitEditMode",
  "knoxchat.debugTerminal",
  "knoxchat.applyCodeFromChat",
  "knox.checkpoints.create",
  "knox.checkpoints.undo",
  "knox.checkpoints.redo",
  "knox.checkpoints.list",
  "knox.checkpoints.fileHistory",
] as const;

export function isKnoxContributedSettingId(id: string): boolean {
  return id.startsWith("knoxchat.") || id.startsWith("knox.checkpoints.");
}

export function knoxManifestConfigurationProperties(
  configuration: unknown,
): Record<string, unknown> {
  if (Array.isArray(configuration)) {
    const out: Record<string, unknown> = {};
    for (const group of configuration as Array<{
      properties?: Record<string, unknown>;
    }>) {
      Object.assign(out, group?.properties ?? {});
    }
    return out;
  }
  return (
    (configuration as { properties?: Record<string, unknown> } | undefined)
      ?.properties ?? {}
  );
}

export function contributedKnoxSettingIds(
  properties: Record<string, unknown> | undefined,
): string[] {
  return Object.keys(properties ?? {})
    .filter(isKnoxContributedSettingId)
    .sort();
}

export function isKnoxSyncKeybindingCommand(id: string): boolean {
  return id.startsWith("knoxchat.") || id.startsWith("knox.checkpoints.");
}

export function contributedKnoxKeybindingCommands(
  keybindings: Array<{ command?: string }> | undefined,
): string[] {
  return [
    ...new Set(
      (keybindings ?? [])
        .map((entry) => entry.command)
        .filter((id): id is string => Boolean(id && isKnoxSyncKeybindingCommand(id))),
    ),
  ].sort();
}
