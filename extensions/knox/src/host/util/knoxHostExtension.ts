import * as vscode from "vscode";

/** Builtin first, then the marketplace VSIX (KN-142). */
export const KNOX_HOST_EXTENSION_IDS = ["vscode.knox", "knoxchat.knoxchat"] as const;

export function getKnoxHostExtension(): vscode.Extension<unknown> | undefined {
  for (const id of KNOX_HOST_EXTENSION_IDS) {
    const extension = vscode.extensions.getExtension(id);
    if (extension) {
      return extension;
    }
  }
  return undefined;
}

export function requireKnoxHostExtension(): vscode.Extension<unknown> {
  const extension = getKnoxHostExtension();
  if (!extension) {
    throw new Error(
      `Expected ${KNOX_HOST_EXTENSION_IDS.join(" or ")} to be present in the test host`,
    );
  }
  return extension;
}
