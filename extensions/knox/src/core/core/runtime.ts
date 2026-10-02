import type { ConfigHandler } from "../config/ConfigHandler";
import type { IDE } from "..";
import type { FromCoreProtocol, ToCoreProtocol } from "../protocol";
import type { IMessenger } from "../protocol/messenger";
import type { AgentWorktreeState } from "../tools/worktree";
import type { GlobalContext } from "../util/GlobalContext";

/**
 * Mutable Core instance handed to messenger handler modules.
 * Fields that were private on the former monolithic class stay on Core
 * so handlers in this directory can share abort/worktree state.
 */
export interface CoreRuntime {
  readonly messenger: IMessenger<ToCoreProtocol, FromCoreProtocol>;
  readonly ide: IDE;
  readonly onWrite: (text: string) => Promise<void>;
  configHandler: ConfigHandler;
  readonly globalContext: GlobalContext;
  readonly abortedMessageIds: Set<string>;
  readonly activeToolAborts: Map<string, AbortController>;
  agentWorktree: AgentWorktreeState | null;
  abortActiveTools(messageId?: string): void;
  send<T extends keyof FromCoreProtocol>(
    messageType: T,
    data: FromCoreProtocol[T][0],
    messageId?: string,
  ): string;
  invoke<T extends keyof ToCoreProtocol>(
    messageType: T,
    data: ToCoreProtocol[T][0],
  ): ToCoreProtocol[T][1];
}
