import type { ChatMessage, IDE, Tool } from "core";
import {
  buildDoomLoopBlockedMessage,
  buildDoomLoopSummaryInstruction,
  detectDoomLoop,
  type DoomLoopCall,
} from "core/agent/doomLoop";
import {
  overlayAutoProfile,
  resolveAgentMaxSteps,
  resolveDoomLoopThreshold,
} from "core/config/agentProfile";
import { loadCodebaseCard, setCodebaseCardInject } from "core/context/codebaseCard";
import {
  rustPolicyShouldEnable,
  setRustPolicyEnabled,
  setRustUserTask,
} from "core/context/rustPolicy";
import {
  loadSerialContextFromJobs,
  setSerialContextInject,
} from "core/context/serialContext";
import { getJevConfirmedProfile } from "core/jev/config";
import { constructMessages } from "core/llm/constructMessages";
import type {
  NativeAgentRequestInput,
  NativeAgentRequestOutput,
  NativeDoomLoopCall,
  NativeDoomLoopInput,
  NativeDoomLoopOutput,
  NativeHydrateAssistantInput,
  NativeHydrateAssistantOutput,
  NativeToolPolicyInput,
  NativeToolPolicyOutput,
} from "core/protocol/nativeAgent";
import { hydrateAssistantTextToolCalls } from "core/llm/parseTextToolCalls";
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  isToolAutoApproved,
  resolvePermissionToolName,
  type PermissionMode,
  type ToolSetting,
} from "core/agent/permissions";
import {
  evaluateToolPolicy,
  resolveConfigAgentPolicy,
  type AgentToolPolicy,
} from "core/tools/toolPolicy";
import { BuiltInToolNames } from "core/tools/builtIn";
import { selectAgentTools } from "core/tools/catalog";
import { listShellJobs } from "core/tools/shellJobs";

type Experimental = {
  agentProfile?: unknown;
  agentProfileSetting?: unknown;
  agentMaxSteps?: unknown;
  agentDoomLoopThreshold?: unknown;
};

type PolicyExperimental = {
  agentPolicy?: AgentToolPolicy | null;
  agentPolicyFromRules?: AgentToolPolicy | null;
};

export interface NativeAgentRequestDeps {
  ide: Pick<IDE, "getWorkspaceDirs" | "listDir" | "fileExists" | "readFile"> &
    Partial<Pick<IDE, "debugControl">>;
  configTools: Tool[] | undefined;
  experimental: Experimental | undefined;
}

function messageText(message: ChatMessage | undefined): string {
  if (!message) {
    return "";
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => ("text" in part ? part.text : ""))
      .join("\n");
  }
  return "";
}

/** Same as the GUI `mergeInjectIntoMessages`: extend the leading system message. */
export function mergeInjectIntoMessages(
  messages: ChatMessage[],
  injected: string | undefined,
): ChatMessage[] {
  if (!injected?.trim()) {
    return messages;
  }
  const first = messages[0];
  if (first?.role === "system") {
    return [
      { ...first, content: `${messageText(first)}\n\n${injected}` },
      ...messages.slice(1),
    ];
  }
  return [{ role: "system", content: injected }, ...messages];
}

function injectSystemInstruction(messages: ChatMessage[], text: string): ChatMessage[] {
  const trimmed = text.trim();
  const first = messages[0];
  if (first?.role === "system") {
    const existing = messageText(first);
    if (existing.includes(trimmed.slice(0, 48))) {
      return messages;
    }
    return [{ ...first, content: `${existing}\n\n${trimmed}` }, ...messages.slice(1)];
  }
  return [{ role: "system", content: trimmed }, ...messages];
}

function toDoomCall(call: NativeDoomLoopCall): DoomLoopCall {
  return { name: call.name, args: call.args, output: call.output, ok: call.ok };
}

function loopProfile(experimental: Experimental | undefined) {
  return overlayAutoProfile(experimental, false, getJevConfirmedProfile());
}

async function debugSessionActive(
  ide: NativeAgentRequestDeps["ide"],
): Promise<boolean> {
  try {
    const status = await ide.debugControl?.({ op: "status" });
    return Boolean(status?.sessionActive);
  } catch {
    return false;
  }
}

async function refreshSystemInjects(
  ide: NativeAgentRequestDeps["ide"],
  lastUserText: string,
): Promise<void> {
  try {
    const card = await loadCodebaseCard(ide as IDE);
    setCodebaseCardInject(card);
    setRustPolicyEnabled(rustPolicyShouldEnable({ card }));
    setRustUserTask(lastUserText);
  } catch {
    setCodebaseCardInject("");
    setRustPolicyEnabled(false);
    setRustUserTask("");
  }
  try {
    setSerialContextInject(loadSerialContextFromJobs(listShellJobs()));
  } catch {
    setSerialContextInject("");
  }
}

export async function selectNativeAgentTools(
  input: Pick<NativeAgentRequestInput, "toolSettings" | "excludedGroups" | "dropSearchWeb">,
  deps: NativeAgentRequestDeps,
): Promise<Tool[]> {
  const systems = loopProfile(deps.experimental) === "systems";
  const settings = input.toolSettings ?? {};
  const excluded = new Set(input.excludedGroups ?? []);
  return selectAgentTools(deps.configTools ?? [], {
    systems,
    debugSessionActive: await debugSessionActive(deps.ide),
  }).filter((tool) => {
    if (settings[tool.function.name] === "disabled" || excluded.has(tool.group)) {
      return false;
    }
    return !(input.dropSearchWeb && tool.function.name === BuiltInToolNames.SearchWeb);
  });
}

export async function buildNativeAgentRequest(
  input: NativeAgentRequestInput,
  deps: NativeAgentRequestDeps,
): Promise<NativeAgentRequestOutput> {
  const history = input.history ?? [];
  const lastUser = [...history].reverse().find((item) => item.message.role === "user");
  await refreshSystemInjects(deps.ide, messageText(lastUser?.message));

  let messages = constructMessages([...history], input.sessionId);
  messages = mergeInjectIntoMessages(messages, input.injectedContext);

  const profile = loopProfile(deps.experimental);
  const maxSteps = resolveAgentMaxSteps(deps.experimental?.agentMaxSteps, profile);
  const output: NativeAgentRequestOutput = {
    messages,
    tools: [],
    maxSteps,
    atMaxSteps: false,
  };
  if (!input.includeTools) {
    return output;
  }

  const threshold = resolveDoomLoopThreshold(
    deps.experimental?.agentDoomLoopThreshold,
    profile,
  );
  const hit = detectDoomLoop((input.turnToolCalls ?? []).map(toDoomCall), { threshold });
  if (hit) {
    output.messages = injectSystemInstruction(messages, buildDoomLoopSummaryInstruction(hit));
    output.doomLoop = { kind: hit.kind, toolName: hit.toolName, count: hit.count };
    return output;
  }

  const steps = input.toolLoopSteps ?? 0;
  if (maxSteps !== null && steps >= maxSteps) {
    output.messages = injectSystemInstruction(
      messages,
      [
        `[Agent max steps] You have reached the maximum of ${maxSteps} tool rounds for this turn.`,
        "Do not call any tools.",
        "Summarize what you accomplished, what is still unfinished, and the recommended next steps for the user.",
      ].join(" "),
    );
    output.atMaxSteps = true;
    return output;
  }

  output.tools = await selectNativeAgentTools(input, deps);
  return output;
}

const PERMISSION_MODE_SET = new Set<string>(PERMISSION_MODES);

export function evaluateNativeToolPolicy(
  input: NativeToolPolicyInput,
  experimental: PolicyExperimental | undefined,
  workspaceDirs: string[],
): NativeToolPolicyOutput {
  const policy = experimental?.agentPolicy ?? null;
  const policyFromRules = experimental?.agentPolicyFromRules ?? null;
  const decision = evaluateToolPolicy({
    toolName: resolvePermissionToolName(input.toolName),
    args: input.args,
    policy: resolveConfigAgentPolicy({
      agentPolicy: policy,
      agentPolicyFromRules: policyFromRules,
    }),
    workspaceDirs,
  });
  const hardDeny = decision.action === "deny";
  if (hardDeny) {
    return { hardDeny, autoApproved: false, reason: decision.reason };
  }
  const permissionMode = PERMISSION_MODE_SET.has(input.permissionMode)
    ? (input.permissionMode as PermissionMode)
    : DEFAULT_PERMISSION_MODE;
  return {
    hardDeny,
    autoApproved: isToolAutoApproved({
      toolName: input.toolName,
      toolSettings: (input.toolSettings ?? {}) as Record<string, ToolSetting>,
      permissionMode,
      sessionAllowlist: input.sessionAllowlist,
      args: input.args,
      policy,
      policyFromRules,
      workspaceDirs,
    }),
  };
}

export function hydrateNativeAssistant(
  input: NativeHydrateAssistantInput,
): NativeHydrateAssistantOutput {
  return hydrateAssistantTextToolCalls(input.content ?? "", input.toolCalls ?? []);
}

export function checkNativeDoomLoop(
  input: NativeDoomLoopInput,
  experimental: Experimental | undefined,
): NativeDoomLoopOutput {
  const threshold = resolveDoomLoopThreshold(
    experimental?.agentDoomLoopThreshold,
    loopProfile(experimental),
  );
  const hit = detectDoomLoop(
    [...(input.turnToolCalls ?? []), input.pending].map(toDoomCall),
    { threshold },
  );
  return hit
    ? {
        blockedMessage: buildDoomLoopBlockedMessage(hit),
        kind: hit.kind,
        toolName: hit.toolName,
      }
    : {};
}
