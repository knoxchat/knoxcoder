import fs from "fs";

import { getKnoxGlobalPath } from "core/util/paths";
import { ExtensionContext } from "vscode";

/**
 * Clear all Knox-related artifacts to simulate a brand new user
 */
export function cleanSlate(context: ExtensionContext) {
  // Commented just to be safe
  // // Remove ~/.knox
  // const knoxPath = getKnoxGlobalPath();
  // if (fs.existsSync(knoxPath)) {
  //   fs.rmSync(knoxPath, { recursive: true, force: true });
  // }
  // // Clear extension's globalState
  // context.globalState.keys().forEach((key) => {
  //   context.globalState.update(key, undefined);
  // });
}
