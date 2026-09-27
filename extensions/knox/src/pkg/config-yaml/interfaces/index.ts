import { SecretResult } from "./SecretResult.js";
import { FQSN, FullSlug } from "./slugs.js";

/**
 * A registry stores the content of packages.
 * KnoxChat local mode uses a stub that rejects remote `uses:` blocks.
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
