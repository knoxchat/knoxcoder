import { fileURLToPath, pathToFileURL } from "url";

import * as URI from "./uriApi.js";
import { t } from "../i18n/index.js";

// CAN ONLY BE USED IN CORE

// Converts a local path to a file:/// URI
export function localPathToUri(path: string) {
  // This may incidentally solve bugs, but it is primarily here to warn us if we accidentally try to double-convert. It doesn't handle other URI schemes.
  if (path.startsWith("file://")) {
    console.warn(t("pathAlreadyFileUri"));
    return path;
  }
  const url = pathToFileURL(path);
  return URI.normalize(url.toString());
}

export function localPathOrUriToPath(localPathOrUri: string): string {
  try {
    return fileURLToPath(localPathOrUri);
  } catch {
    if (localPathOrUri.startsWith("file:")) {
      try {
        // POSIX file:// URIs (file:///tmp/x) have no drive letter, so
        // fileURLToPath throws on Windows. Keep the URL path.
        return decodeURIComponent(new URL(localPathOrUri).pathname);
      } catch {
        return localPathOrUri;
      }
    }
    return localPathOrUri;
  }
}
