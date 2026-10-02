import { enrichWithCost } from "../llm/tokenTracking";
import { DevDataSqliteDb } from "../data/devdataSqlite";
import { DataLogger } from "../data/log";

import type { CoreRuntime } from "./runtime";

export function registerStatsHandlers(core: CoreRuntime): void {
  const on = core.messenger.on.bind(core.messenger);

  // Dev data
  on("devdata/log", async (msg) => {
    void DataLogger.getInstance().logDevData(msg.data);
  });

  on("stats/getTokensPerDay", async (msg) => {
    const rows = await DevDataSqliteDb.getTokensPerDay();
    return rows;
  });
  on("stats/getTokensPerModel", async (msg) => {
    const rows = await DevDataSqliteDb.getTokensPerModel();
    return rows;
  });
  on("stats/getTokensPerModelWithCost", async (msg) => {
    const rows = await DevDataSqliteDb.getTokensPerModel();
    return enrichWithCost(rows);
  });
}
