import type { IDE } from "..";
import { collectActivePaths } from "../config/rules";
import { getSkillManager } from "../tools/implementations/skillSingleton";

/** Tell the skill manager which files are open so `globs`-scoped skills can match. Best effort. */
export async function refreshSkillScope(ide: IDE): Promise<void> {
  const manager = getSkillManager();
  if (!manager) {
    return;
  }
  try {
    manager.setActivePaths(await collectActivePaths(ide));
  } catch {
    manager.setActivePaths(undefined);
  }
}
