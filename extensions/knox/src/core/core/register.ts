import { registerAbortAndAgentHandlers } from "./agent";
import { registerBrainHandlers } from "./brain";
import { registerBrainAdminHandlers } from "./brainAdmin";
import { registerBrainLoopHandlers } from "./brainLoop";
import { registerConfigHandlers } from "./config";
import { registerContextHandlers } from "./context";
import { registerFileHandlers } from "./files";
import { registerHistoryHandlers } from "./history";
import { registerLlmHandlers } from "./llm";
import { registerMemoryHandlers } from "./memory";
import { registerStatsHandlers } from "./stats";
import { registerTerminalHandlers } from "./terminal";
import { registerToolHandlers } from "./tools";
import type { CoreRuntime } from "./runtime";

export function registerAllCoreHandlers(core: CoreRuntime): void {
  registerAbortAndAgentHandlers(core);
  registerHistoryHandlers(core);
  registerStatsHandlers(core);
  registerConfigHandlers(core);
  registerContextHandlers(core);
  registerMemoryHandlers(core);
  registerBrainHandlers(core);
  registerBrainLoopHandlers(core);
  registerBrainAdminHandlers(core);
  registerLlmHandlers(core);
  registerTerminalHandlers(core);
  registerFileHandlers(core);
  registerToolHandlers(core);
}
