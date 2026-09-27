/**
 * Pinned crate versions + MSRV for rust-profile inject (RL-25 / RL-30).
 *
 * Lockfile versions beat caret ranges in Cargo.toml. Missing lock must not
 * invent versions.
 */

export const PINNED_CRATES_MARKER = "Pinned crates";
export const GENERATE_LOCKFILE_HINT = "run cargo generate-lockfile";

const MAX_PINNED_DEPS = 24;

function tomlSection(text: string, header: string): string {
  const re = new RegExp(
    `^\\[${header.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\]\\s*$`,
    "im",
  );
  const match = re.exec(text);
  if (!match || match.index === undefined) {
    return "";
  }
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const next = rest.search(/^\[[^\]]+\]\s*$/m);
  return next < 0 ? rest : rest.slice(0, next);
}

function tomlString(section: string, key: string): string | undefined {
  const match = section.match(
    new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, "m"),
  );
  return match?.[1];
}

/** Direct dependency names from `[dependencies]`-style tables. */
export function parseCargoDirectDepNames(toml: string): string[] {
  const sections = [
    "dependencies",
    "dev-dependencies",
    "build-dependencies",
    "workspace.dependencies",
  ];
  const names = new Set<string>();
  for (const header of sections) {
    const section = tomlSection(toml, header);
    if (!section) {
      continue;
    }
    for (const line of section.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const dotted = trimmed.match(/^([A-Za-z0-9_-]+)\.(?:workspace|version)\s*=/);
      if (dotted) {
        names.add(dotted[1]);
        continue;
      }
      const kv = trimmed.match(/^([A-Za-z0-9_-]+)\s*=/);
      if (kv) {
        names.add(kv[1]);
      }
    }
  }
  return [...names];
}

/** First resolved version per package name from Cargo.lock (v1–v4). */
export function parseCargoLockVersions(lock: string): Map<string, string> {
  const versions = new Map<string, string>();
  const blocks = lock.split(/^\s*\[\[package\]\]\s*$/im);
  for (const block of blocks) {
    const name = tomlString(block, "name");
    const version = tomlString(block, "version");
    if (name && version && !versions.has(name)) {
      versions.set(name, version);
    }
  }
  return versions;
}

export function parseRustToolchain(text: string): { channel?: string } {
  const quoted = text.match(/^\s*channel\s*=\s*"([^"]+)"/m);
  if (quoted?.[1]) {
    return { channel: quoted[1].trim() };
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("[")) {
      continue;
    }
    if (
      /^(stable|beta|nightly)(?:-\d{4}-\d{2}-\d{2})?$/.test(trimmed) ||
      /^\d+\.\d+(?:\.\d+)?(?:-nightly|-beta)?$/.test(trimmed)
    ) {
      return { channel: trimmed };
    }
  }
  return {};
}

export interface PinnedCrate {
  name: string;
  version: string;
}

export function resolvePinnedCrates(
  cargoToml: string,
  cargoLock?: string,
): { crates: PinnedCrate[]; hasLock: boolean } {
  const names = parseCargoDirectDepNames(cargoToml);
  const lock = (cargoLock ?? "").trim();
  if (!lock) {
    return { crates: [], hasLock: false };
  }
  const versions = parseCargoLockVersions(lock);
  const crates: PinnedCrate[] = [];
  for (const name of names) {
    const version = versions.get(name);
    if (version) {
      crates.push({ name, version });
    }
  }
  crates.sort((a, b) => a.name.localeCompare(b.name));
  return { crates: crates.slice(0, MAX_PINNED_DEPS), hasLock: true };
}

export function formatMsrvLine(opts: {
  rustVersion?: string;
  toolchainChannel?: string;
  hasToolchainFile?: boolean;
}): string | undefined {
  const parts: string[] = [];
  if (opts.toolchainChannel) {
    parts.push(`channel ${opts.toolchainChannel}`);
  } else if (opts.hasToolchainFile) {
    parts.push("rust-toolchain.toml present");
  }
  if (opts.rustVersion) {
    parts.push(`package.rust-version ${opts.rustVersion}`);
  }
  if (!parts.length) {
    return undefined;
  }
  return `MSRV / toolchain: ${parts.join("; ")}. Pass through rustup — do not append +nightly unless miri/sanitizers are required.`;
}

/** Compact “Pinned crates” block for the codebase card. */
export function formatPinnedCratesBlock(
  cargoToml: string,
  cargoLock?: string,
): string {
  const { crates, hasLock } = resolvePinnedCrates(cargoToml, cargoLock);
  if (!hasLock) {
    return `${PINNED_CRATES_MARKER}: no Cargo.lock — ${GENERATE_LOCKFILE_HINT}. Do not invent crate versions.`;
  }
  if (!crates.length) {
    return `${PINNED_CRATES_MARKER} (Cargo.lock): none (no direct deps resolved).`;
  }
  const list = crates.map((crate) => `${crate.name} ${crate.version}`).join(", ");
  return `${PINNED_CRATES_MARKER} (Cargo.lock): ${list}. Use these versions, not caret ranges.`;
}
