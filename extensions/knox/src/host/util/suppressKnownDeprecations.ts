/**
 * Node 24+ emits deprecation warnings for legacy APIs still used by bundled
 * transitive dependencies (follow-redirects, tr46/jsdom, etc.). Filter the
 * known harmless ones so extension dev logs stay readable.
 */
const SUPPRESSED_DEPRECATION_CODES = new Set(["DEP0040", "DEP0169"]);

export function suppressKnownDeprecations(): void {
  if (process.env.KNOX_SHOW_NODE_DEPRECATIONS === "1") {
    return;
  }

  const originalEmit = process.emit.bind(process);
  process.emit = function emitWithFilteredDeprecations(
    event: string | symbol,
    ...args: unknown[]
  ): boolean {
    if (event === "warning") {
      const warning = args[0] as NodeJS.ErrnoException | undefined;
      if (
        warning?.name === "DeprecationWarning" &&
        typeof warning.code === "string" &&
        SUPPRESSED_DEPRECATION_CODES.has(warning.code)
      ) {
        return true;
      }
    }
    return Reflect.apply(originalEmit, process, [event, ...args]);
  };
}

suppressKnownDeprecations();
