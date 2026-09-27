/**
 * Short first-turn "codebase card" for kernel / QEMU / Cargo trees (HL-28 / RL-09).
 *
 * Injected as a system message. Never dumps `.config` (only ARCH inference).
 */

import type { IDE } from "..";
import {
  detectWorkspaceKind,
  RUST_VERIFY_COMMAND,
  type WorkspaceKind,
} from "../config/agentProfile";
import { joinPathsToUri } from "../util/uri";
import {
  formatMsrvLine,
  formatPinnedCratesBlock,
  parseRustToolchain,
} from "./cargoCard";

export const CODEBASE_CARD_MARKER = "Codebase Card";

const FILE_TYPE_DIRECTORY = 2;

const ARCH_FROM_CONFIG: Array<[RegExp, string]> = [
  [/^CONFIG_X86_64=y/m, "x86_64"],
  [/^CONFIG_ARM64=y/m, "arm64"],
  [/^CONFIG_RISCV=y/m, "riscv"],
  [/^CONFIG_LOONGARCH=y/m, "loongarch"],
  [/^CONFIG_PPC64=y/m, "powerpc"],
  [/^CONFIG_SPARC64=y/m, "sparc"],
  [/^CONFIG_S390=y/m, "s390"],
  [/^CONFIG_MIPS=y/m, "mips"],
  [/^CONFIG_ARC=y/m, "arc"],
  [/^CONFIG_X86=y/m, "x86"],
  [/^CONFIG_ARM=y/m, "arm"],
];

let injectedCard = "";

export function setCodebaseCardInject(card: string): void {
  injectedCard = card.trim();
}

export function formatCodebaseCardInject(): string {
  return injectedCard;
}

export function resetCodebaseCardForTests(): void {
  injectedCard = "";
}

export interface CargoManifestInfo {
  name?: string;
  edition?: string;
  rustVersion?: string;
  workspaceMembers: string[];
}

function tomlSection(text: string, header: string): string {
  const re = new RegExp(`^\\[${header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\s*$`, "im");
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

function tomlStringList(section: string, key: string): string[] {
  const match = section.match(
    new RegExp(`^\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]`, "ms"),
  );
  if (!match) {
    return [];
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function memberName(pathOrName: string): string {
  const cleaned = pathOrName.replace(/\\/g, "/").replace(/\/+$/, "");
  const slash = cleaned.lastIndexOf("/");
  return slash >= 0 ? cleaned.slice(slash + 1) : cleaned;
}

/** Best-effort `[package]` / `[workspace]` fields from a Cargo.toml snippet. */
export function parseCargoManifest(text: string): CargoManifestInfo {
  const pkg = tomlSection(text, "package");
  const workspace = tomlSection(text, "workspace");
  const workspacePkg = tomlSection(text, "workspace.package");
  const members = tomlStringList(workspace, "members").map(memberName);
  return {
    name: tomlString(pkg, "name"),
    edition: tomlString(pkg, "edition") ?? tomlString(workspacePkg, "edition"),
    rustVersion:
      tomlString(pkg, "rust-version") ?? tomlString(workspacePkg, "rust-version"),
    workspaceMembers: members.filter(Boolean),
  };
}

export function inferArchFromConfig(configText: string): string | undefined {
  const slice = configText.slice(0, 32_000);
  for (const [re, arch] of ARCH_FROM_CONFIG) {
    if (re.test(slice)) {
      return arch;
    }
  }
  return undefined;
}

export function buildCodebaseCard(input: {
  entryNames: string[];
  topDirs?: string[];
  configText?: string;
  cargoToml?: string;
  cargoLock?: string;
  rustToolchain?: boolean;
  rustToolchainText?: string;
  clippyToml?: boolean;
  rustfmtToml?: boolean;
  kind?: WorkspaceKind;
}): string {
  const names = input.entryNames;
  const kind = input.kind ?? detectWorkspaceKind(names);
  if (!kind) {
    return "";
  }

  const dirs = (input.topDirs ?? names.filter((n) => !n.includes(".")))
    .filter((n) => n && n !== "." && !n.startsWith("."))
    .slice(0, 24);
  const dirList = dirs.length ? dirs.map((d) => `${d}/`).join(" ") : "(unknown)";

  if (kind === "cargo") {
    const manifest = parseCargoManifest(input.cargoToml ?? "");
    const crate =
      manifest.name && manifest.edition
        ? `${manifest.name} (edition ${manifest.edition})`
        : manifest.name
          ? manifest.name
          : manifest.edition
            ? `edition ${manifest.edition}`
            : "Cargo crate";
    const members = manifest.workspaceMembers.length
      ? manifest.workspaceMembers.join(", ")
      : "none (single crate)";
    const extras = [
      input.rustToolchain || input.rustToolchainText
        ? "rust-toolchain.toml"
        : "",
      input.clippyToml ? "clippy.toml" : "",
      input.rustfmtToml ? "rustfmt.toml" : "",
    ].filter(Boolean);
    const extraLine = extras.length
      ? `Toolchain files: ${extras.join(", ")}`
      : "Toolchain files: none at repo root";
    const toolchain = parseRustToolchain(input.rustToolchainText ?? "");
    const msrv = formatMsrvLine({
      rustVersion: manifest.rustVersion,
      toolchainChannel: toolchain.channel,
      hasToolchainFile: Boolean(
        input.rustToolchain || input.rustToolchainText,
      ),
    });
    const pinned = formatPinnedCratesBlock(
      input.cargoToml ?? "",
      input.cargoLock,
    );
    return [
      `## ${CODEBASE_CARD_MARKER}`,
      `This workspace looks like a Cargo crate / workspace: ${crate}.`,
      `Workspace members: ${members}.`,
      extraLine,
      msrv,
      pinned,
      `Oracle: builtin_build → \`${RUST_VERIFY_COMMAND}\`. Do not cargo clean.`,
      "Search with builtin_exact_search: fileType rust and path src/ (or a crate member).",
      "Prefer rust-analyzer hover / go-to-definition over guessing method names.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (kind === "qemu") {
    return [
      `## ${CODEBASE_CARD_MARKER}`,
      "This workspace looks like QEMU (meson.build + target/accel/hw).",
      "Build: `ninja -C build` or `meson compile -C build`. Prefer builtin_build.",
      `Top-level dirs: ${dirList}`,
      "Search with builtin_exact_search path (e.g. target/i386/) and fileType c.",
      "Who owns a path: builtin_maintainers lookup. Do not dump pc-bios/ blobs into context. Use builtin_pty_* for qemu-system serial.",
    ].join("\n");
  }

  const arch = inferArchFromConfig(input.configText ?? "") ?? "x86_64";
  return [
    `## ${CODEBASE_CARD_MARKER}`,
    "This workspace looks like a Linux kernel (Kconfig + Makefile/arch).",
    `Build: \`make ARCH=${arch}\` (or knoxchat.verifyCommand). Prefer builtin_build. Do not run make mrproper/clean unless asked.`,
    `Top-level dirs: ${dirList}`,
    'Search with builtin_exact_search: prefer path (e.g. "mm/") and fileType "c".',
    "Who owns a path: builtin_maintainers lookup (do not dump MAINTAINERS).",
    "clangd needs compile_commands.json (bear -- make, or scripts/clang-tools). If missing, use tags (`make tags`) or grep.",
  ].join("\n");
}

export async function loadCodebaseCard(ide: IDE): Promise<string> {
  const dirs = await ide.getWorkspaceDirs();
  const root = dirs[0];
  if (!root || typeof ide.listDir !== "function") {
    return "";
  }
  let entries: [string, number][] = [];
  try {
    entries = await ide.listDir(root);
  } catch {
    return "";
  }
  const entryNames = entries.map(([name]) => name);
  const kind = detectWorkspaceKind(entryNames);
  if (!kind) {
    return "";
  }

  let configText = "";
  let cargoToml = "";
  let cargoLock = "";
  let rustToolchainText = "";
  try {
    const configUri = joinPathsToUri(root, ".config");
    if (await ide.fileExists(configUri)) {
      const raw = await ide.readFile(configUri);
      configText = raw.split("\n").slice(0, 400).join("\n");
    }
  } catch {
    // ARCH falls back to x86_64
  }
  try {
    const cargoUri = joinPathsToUri(root, "Cargo.toml");
    if (await ide.fileExists(cargoUri)) {
      cargoToml = await ide.readFile(cargoUri);
    }
  } catch {
    // Card still describes a crate from the filename.
  }
  try {
    const lockUri = joinPathsToUri(root, "Cargo.lock");
    if (await ide.fileExists(lockUri)) {
      cargoLock = await ide.readFile(lockUri);
    }
  } catch {
    // Pinned-crates block will ask for generate-lockfile.
  }
  try {
    for (const name of ["rust-toolchain.toml", "rust-toolchain"]) {
      const uri = joinPathsToUri(root, name);
      if (await ide.fileExists(uri)) {
        rustToolchainText = await ide.readFile(uri);
        break;
      }
    }
  } catch {
    // MSRV falls back to package.rust-version.
  }

  const exists = async (name: string): Promise<boolean> => {
    try {
      return await ide.fileExists(joinPathsToUri(root, name));
    } catch {
      return false;
    }
  };

  const topDirs = entries
    .filter(([, type]) => type === FILE_TYPE_DIRECTORY)
    .map(([name]) => name);

  return buildCodebaseCard({
    entryNames,
    topDirs,
    configText,
    cargoToml,
    cargoLock,
    rustToolchain:
      Boolean(rustToolchainText) ||
      (await exists("rust-toolchain.toml")) ||
      (await exists("rust-toolchain")),
    rustToolchainText,
    clippyToml: await exists("clippy.toml"),
    rustfmtToml: await exists("rustfmt.toml"),
    kind,
  });
}
