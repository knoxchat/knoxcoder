/**
 * Singleton accessor for the SkillManager instance.
 *
 * The SkillManager is initialized by the extension activation code
 * (or by core.ts) and then made available here so tool implementations
 * can access it without circular dependencies.
 */

import { SkillManager } from "../../skills";

let _instance: SkillManager | undefined;

/**
 * Set the global SkillManager instance.
 * Should be called during extension/core initialization.
 */
export function setSkillManager(manager: SkillManager): void {
  _instance = manager;
}

/**
 * Get the global SkillManager instance.
 * Returns undefined if not yet initialized.
 */
export function getSkillManager(): SkillManager | undefined {
  return _instance;
}
