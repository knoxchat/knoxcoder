/**
 * KN-364: vscode-free public KnoxAPI helpers (Git analog: `api1.ts`).
 *
 * Other extensions copy `extensions/knox/src/api/knox.d.ts` and call
 * `getAPI(1)`. Command ids and adapters live here so mocha can assert
 * the contract without the vscode module.
 */

export const KNOX_API_VERSION = 1;
export const KNOX_EXTENSION_ID = "vscode.knox";

export const KNOX_OPEN_CHAT_COMMAND = "knox.openChat";
export const KNOX_NEW_SESSION_COMMAND = "knox.newSession";
export const KNOX_TOGGLE_AGENT_MODE_COMMAND = "knox.toggleAgentMode";
export const KNOX_EXECUTE_TOOL_CALL_COMMAND = "knox.executeToolCall";
export const KNOX_SEND_USER_INPUT_MESSAGE = "userInput";
export const KNOX_FOCUS_INPUT_WITHOUT_CLEAR_MESSAGE = "focusKnoxInputWithoutClear";

export const KNOX_API_METHODS = [
  "isAgentModeActive",
  "toggleAgentMode",
  "executeToolCall",
  "registerCustomContextProvider",
  "openChat",
  "newSession",
  "handleGuiMessage",
] as const;

export const KNOX_API_EVENTS = [
  "onDidChangeAgentMode",
  "onDidReceiveGuiMessage",
] as const;

export type PublicOpenChatOptions = {
  readonly prompt?: string;
};

export type PublicToolCall = {
  readonly id?: string;
  readonly type?: string;
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
};

export type PublicContextItemUri = {
  readonly type: string;
  readonly value: string;
};

export type PublicContextItem = {
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly uri?: PublicContextItemUri;
};

export type PublicCustomContextProvider = {
  readonly description: {
    readonly title: string;
    readonly displayTitle?: string;
  };
  getContextItems(
    query: string,
    extras: unknown,
  ): PromiseLike<PublicContextItem[]>;
  loadSubmenuItems?(args: unknown): PromiseLike<unknown[]>;
};

export type CoreToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type HostContextProviderDescription = {
  title: string;
  displayTitle: string;
  description: string;
  type: "normal";
};

export type HostContextSubmenuItem = {
  id: string;
  title: string;
  description: string;
};

export type HostContextProvider = {
  readonly description: HostContextProviderDescription;
  getContextItems(query: string, extras: unknown): Promise<PublicContextItem[]>;
  loadSubmenuItems(args: unknown): Promise<HostContextSubmenuItem[]>;
};

export type OpenChatPlan =
  | { kind: "focus" }
  | { kind: "focusAndSubmit"; prompt: string };

export function assertKnoxApiVersion(version: number): asserts version is 1 {
  if (version !== KNOX_API_VERSION) {
    throw new Error(`No Knox API version ${version} found.`);
  }
}

export function planOpenChat(options?: PublicOpenChatOptions): OpenChatPlan {
  const prompt = options?.prompt?.trim();
  if (prompt) {
    return { kind: "focusAndSubmit", prompt };
  }
  return { kind: "focus" };
}

export function toCoreToolCall(toolCall: PublicToolCall): CoreToolCall {
  return {
    id: toolCall.id?.trim() || `knox-api-${toolCall.function.name}`,
    type: "function",
    function: {
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    },
  };
}

export function toPublicContextItems(
  items: ReadonlyArray<{
    name?: string;
    description?: string;
    content?: string;
    uri?: { type?: string; value?: string };
  }> | undefined,
): PublicContextItem[] {
  if (!items?.length) {
    return [];
  }
  return items.map((item) => {
    const mapped: PublicContextItem = {
      name: String(item.name ?? ""),
      description: String(item.description ?? ""),
      content: String(item.content ?? ""),
    };
    if (item.uri && typeof item.uri.value === "string") {
      return {
        ...mapped,
        uri: {
          type: String(item.uri.type ?? "file"),
          value: item.uri.value,
        },
      };
    }
    return mapped;
  });
}

export function wrapCustomContextProvider(
  provider: PublicCustomContextProvider,
): HostContextProvider {
  const title = provider.description.title;
  return {
    description: {
      title,
      displayTitle: provider.description.displayTitle ?? title,
      description: "",
      type: "normal",
    },
    async getContextItems(query, extras) {
      return toPublicContextItems(await provider.getContextItems(query, extras));
    },
    async loadSubmenuItems(args) {
      if (!provider.loadSubmenuItems) {
        return [];
      }
      return asSubmenuItems(await provider.loadSubmenuItems(args));
    },
  };
}

function asSubmenuItems(value: unknown): HostContextSubmenuItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item, index) => {
    const rec =
      item && typeof item === "object"
        ? (item as Record<string, unknown>)
        : {};
    const id = String(rec.id ?? index);
    return {
      id,
      title: String(rec.title ?? rec.name ?? id),
      description: String(rec.description ?? ""),
    };
  });
}
