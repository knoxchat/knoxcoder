/**
 * Explicit on-disk schema versions for user data in `~/.knoxcoder`.
 *
 * 0 = written before versioning existed (1.138.x, 2.0.0-beta). Readers accept
 * every version up to the current one and never refuse newer data (a downgrade
 * still opens it best-effort), but a writer first keeps a one-time backup of any
 * file whose version differs from its own, so nothing is lost either way.
 */
import * as fs from "fs";

/** Session file (`sessions/<id>.json`). `sessions.json` stays a bare array for downgrade compatibility. */
export const SESSION_SCHEMA_VERSION = 1;

/** `config.yaml` top-level `schema:` values this build understands. */
export const SUPPORTED_CONFIG_SCHEMAS: readonly string[] = ["v1"];

/**
 * Copy `file` to `<file>.v<version>.bak` once, if it exists and the backup does
 * not. Returns the backup path when one was made.
 */
export function backupOnce(file: string, version: number | string): string | undefined {
  try {
    if (!fs.existsSync(file)) return undefined;
    const dest = `${file}.v${version}.bak`;
    if (fs.existsSync(dest)) return undefined;
    fs.copyFileSync(file, dest);
    return dest;
  } catch {
    return undefined;
  }
}

/** Version of a stored session object (0 when absent). */
export function sessionVersionOf(value: unknown): number {
  const v = (value as { schemaVersion?: unknown } | null)?.schemaVersion;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0;
}

/**
 * Inspect a config.yaml's `schema:` key. Returns a message when the file declares
 * a schema this build does not know; undefined when fine or absent.
 */
export function configSchemaProblem(yamlText: string): string | undefined {
  const m = /^schema:\s*["']?([^\s"'#]+)["']?\s*(?:#.*)?$/m.exec(yamlText);
  if (!m) return undefined;
  if (SUPPORTED_CONFIG_SCHEMAS.includes(m[1])) return undefined;
  return `config.yaml declares schema "${m[1]}", but this version of Knox supports ${SUPPORTED_CONFIG_SCHEMAS.join(", ")}. Some settings may be ignored.`;
}
