import { Registry } from "./interfaces/index.js";
import { FullSlug } from "./interfaces/slugs.js";

/**
 * Local-only registry stub. Remote `uses:` package fetch is not supported.
 * Callers that hit this path get a clear error instead of a broken relative URL.
 */
export class RegistryClient implements Registry {
  async getContent(fullSlug: FullSlug): Promise<string> {
    throw new Error(
      `Remote config blocks (uses: ${fullSlug.ownerSlug}/${fullSlug.packageSlug}) are not supported. ` +
        "Inline the block in config.yaml or remove the uses: reference.",
    );
  }
}
