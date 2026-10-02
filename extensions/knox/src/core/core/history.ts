import historyManager from "../util/history";
import { slimSessionForGui } from "../util/sessionDisplayCap";

import type { CoreRuntime } from "./runtime";

export function registerHistoryHandlers(core: CoreRuntime): void {
  const on = core.messenger.on.bind(core.messenger);

  // History
  on("history/list", (msg) => {
    return historyManager.list(msg.data);
  });

  on("history/delete", (msg) => {
    historyManager.delete(msg.data.id);
  });

  on("history/load", (msg) => {
    return slimSessionForGui(historyManager.load(msg.data.id)).session;
  });

  on("history/save", (msg) => {
    historyManager.save(msg.data);
  });
}
