import { SecretResult } from "./SecretResult.js";
import { FQSN, FullSlug } from "./slugs.js";

/**
 * A registry stores the content of packages.
 * Local `uses: owner/package` loads `~/.knoxcoder/registry/owner/package.yaml`.
 * Remote fetch is not supported.
 */
export interface Registry {
  getContent(fullSlug: FullSlug): Promise<string>;
}

/**
 * Resolves FQSN secret references (e.g. `${{ secrets.OPENAI_API_KEY }}`).
 * Live path: LocalPlatformClient → process.env.
 */
export interface PlatformClient {
  resolveFQSNs(fqsns: FQSN[]): Promise<(SecretResult | undefined)[]>;
}
