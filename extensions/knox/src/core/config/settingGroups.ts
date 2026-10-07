/**
 * Grouping of contributed Knox settings for the grouped settings picker
 * (`knox.openSettings`). Rules are matched in order; a test fails when a
 * contributed setting matches no group, so new settings must be classified.
 */

export interface KnoxSettingGroup {
  id: string;
  label: string;
  description: string;
  /** Setting id prefixes (or exact ids) that belong to this group. */
  match: string[];
}

export const KNOX_SETTING_GROUPS: KnoxSettingGroup[] = [
  {
    id: "assist",
    label: "Editor assist",
    description: "Inline tips, completions, quick actions, CodeLens edits",
    match: [
      "knoxchat.showInlineTip",
      "knoxchat.enableInlineCompletions",
      "knoxchat.inlineCompletionModel",
      "knoxchat.disableQuickFix",
      "knoxchat.enableQuickActions",
      "knoxchat.editAssist.",
      "knoxchat.enableShadowPreview",
      "knoxchat.shadowPreviewLargeFiles",
    ],
  },
  {
    id: "agent",
    label: "Agent and models",
    description: "Profile, Jev, fallback model, tool loading",
    match: [
      "knoxchat.agentProfile",
      "knoxchat.jev.",
      "knoxchat.fallbackModel",
      "knoxchat.deferTools",
    ],
  },
  {
    id: "verify",
    label: "Verification",
    description: "Post-edit checks and verify loop",
    match: ["knoxchat.enablePostEditVerification", "knoxchat.verify"],
  },
  {
    id: "memory",
    label: "Memory and instructions",
    description: "Memory Brain and instruction file compatibility",
    match: ["knoxchat.memoryBrain.", "knoxchat.compatInstructions"],
  },
  {
    id: "network",
    label: "Network and privacy",
    description: "Network mode and allowlist",
    match: ["knoxchat.network"],
  },
  {
    id: "checkpoints",
    label: "Checkpoints",
    description: "Storage, retention, automatic checkpoints, inline diff",
    match: ["knox.checkpoints."],
  },
  {
    id: "deprecated",
    label: "Deprecated",
    description: "Removed keys kept so old settings.json still loads; they are ignored",
    match: ["knoxchat.sandbox", "knoxchat.sharedLoop"],
  },
];

export function groupForSetting(id: string): KnoxSettingGroup | undefined {
  return KNOX_SETTING_GROUPS.find((g) => g.match.some((m) => id.startsWith(m)));
}

export function groupKnoxSettings(
  ids: readonly string[],
): { group: KnoxSettingGroup; ids: string[] }[] {
  const buckets = new Map<string, string[]>();
  const other: string[] = [];
  for (const id of ids) {
    const g = groupForSetting(id);
    if (!g) {
      other.push(id);
      continue;
    }
    const list = buckets.get(g.id) ?? [];
    list.push(id);
    buckets.set(g.id, list);
  }
  const out = KNOX_SETTING_GROUPS.filter((g) => buckets.has(g.id)).map((g) => ({
    group: g,
    ids: buckets.get(g.id)!,
  }));
  if (other.length) {
    out.push({
      group: { id: "other", label: "Other", description: "Ungrouped", match: [] },
      ids: other,
    });
  }
  return out;
}

/** Search string for the Settings UI that shows exactly these ids. */
export function settingsSearchQuery(ids: readonly string[]): string {
  return `@id:${ids.join(",")}`;
}
