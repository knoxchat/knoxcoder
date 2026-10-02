import { ConfigHandler } from "../config/ConfigHandler";
import { GlobalContext } from "../util/GlobalContext";

import type { IDE } from "..";
import type { FromCoreProtocol, ToCoreProtocol } from "../protocol";
import type { IMessenger } from "../protocol/messenger";
import type { AgentWorktreeState } from "../tools/worktree";
import { registerAllCoreHandlers } from "./register";
import type { CoreRuntime } from "./runtime";
import {
  createConfigHandler,
  migrateCoreData,
  startBrainAutoConsolidation,
  startSkillSystem,
  wireConfigUpdates,
  wireDataLogger,
} from "./startup";

export class Core implements CoreRuntime {
  configHandler: ConfigHandler;
  readonly globalContext = new GlobalContext();

  readonly abortedMessageIds: Set<string> = new Set();
  /** In-flight tools/call abort controllers, keyed by messenger messageId. */
  readonly activeToolAborts = new Map<string, AbortController>();
  /** Optional git worktree that isolates agent file/shell writes from the main tree. */
  agentWorktree: AgentWorktreeState | null = null;

  abortActiveTools(messageId?: string): void {
    if (messageId) {
      const controller = this.activeToolAborts.get(messageId);
      controller?.abort();
      return;
    }
    for (const controller of this.activeToolAborts.values()) {
      controller.abort();
    }
  }

  invoke<T extends keyof ToCoreProtocol>(
    messageType: T,
    data: ToCoreProtocol[T][0],
  ): ToCoreProtocol[T][1] {
    return this.messenger.invoke(messageType, data);
  }

  send<T extends keyof FromCoreProtocol>(
    messageType: T,
    data: FromCoreProtocol[T][0],
    messageId?: string,
  ): string {
    return this.messenger.send(messageType, data, messageId);
  }

  // TODO: It shouldn't actually need an IDE type, because this can happen
  // through the messenger (it does in the case of any non-VS Code IDEs already)
  constructor(
    readonly messenger: IMessenger<ToCoreProtocol, FromCoreProtocol>,
    readonly ide: IDE,
    readonly onWrite: (text: string) => Promise<void> = async () => {},
  ) {
    migrateCoreData(this);
    startBrainAutoConsolidation(this);

    const ideInfoPromise = messenger.request("getIdeInfo", undefined);
    const ideSettingsPromise = messenger.request("getIdeSettings", undefined);

    this.configHandler = createConfigHandler(this, ideSettingsPromise);

    wireConfigUpdates(this);
    wireDataLogger(this, ideInfoPromise, ideSettingsPromise);
    startSkillSystem(this);
    registerAllCoreHandlers(this);
  }
}
