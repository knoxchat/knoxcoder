/**
 * Context provider tiers.
 *
 * **Core defaults** (always available after load):
 *   file, diff, problems, repo-map, terminal, memory
 *
 * **Core opt-in** (registry; add via config `context:`):
 *   currentFile, open, clipboard, commit, tree, search, os, url, serial
 *
 * **Integrations** (key/config-gated; never default):
 *   google, discord, greptile, postgres, database, issue, http, web, debugger
 *
 * Dead stubs (CodeOutline / CodeHighlights) were removed — do not re-add
 * without a working implementation.
 */

import type { IContextProvider } from "../../index.js";

import ClipboardContextProvider from "./ClipboardContextProvider";
import CurrentFileContextProvider from "./CurrentFileContextProvider";
import DatabaseContextProvider from "./DatabaseContextProvider";
import DebugLocalsProvider from "./DebugLocalsProvider";
import DiffContextProvider from "./DiffContextProvider";
import DiscordContextProvider from "./DiscordContextProvider";
import FileFolderContextProvider from "./FileFolderContextProvider";
import FileTreeContextProvider from "./FileTreeContextProvider";
import GitCommitContextProvider from "./GitCommitContextProvider";
import GitHubIssuesContextProvider from "./GitHubIssuesContextProvider";
import GoogleContextProvider from "./GoogleContextProvider";
import GreptileContextProvider from "./GreptileContextProvider";
import HttpContextProvider from "./HttpContextProvider";
import OpenFilesContextProvider from "./OpenFilesContextProvider";
import OSContextProvider from "./OSContextProvider";
import PostgresContextProvider from "./PostgresContextProvider";
import ProblemsContextProvider from "./ProblemsContextProvider";
import ProjectMemoryContextProvider from "./ProjectMemoryContextProvider";
import RepoMapContextProvider from "./RepoMapContextProvider";
import SearchContextProvider from "./SearchContextProvider";
import SerialContextProvider from "./SerialContextProvider";
import TerminalContextProvider from "./TerminalContextProvider";
import URLContextProvider from "./URLContextProvider";
import WebContextProvider from "./WebContextProvider";
import { BaseContextProvider } from "../index.js";

/** Titles always ensured after config load (deduped). */
export const DEFAULT_CONTEXT_PROVIDER_TITLES = [
  "file",
  "diff",
  "problems",
  "repo-map",
  "terminal",
  "memory",
] as const;

export type DefaultContextProviderTitle =
  (typeof DEFAULT_CONTEXT_PROVIDER_TITLES)[number];

/**
 * Integration / key-gated providers. Opt-in via config only.
 * Missing required params → skipped at load (fail closed).
 */
export const INTEGRATION_CONTEXT_PROVIDER_TITLES = new Set<string>([
  "google",
  "discord",
  "greptile",
  "postgres",
  "database",
  "issue",
  "http",
  "web",
  "debugger",
]);

export type ContextProviderCategory = "core" | "integration";

export function getContextProviderCategory(
  title: string,
): ContextProviderCategory {
  return INTEGRATION_CONTEXT_PROVIDER_TITLES.has(title)
    ? "integration"
    : "core";
}

/** Whether an integration provider has enough params to be useful. */
export function integrationProviderReady(
  title: string,
  params: Record<string, unknown> | undefined,
): { ok: boolean; reason?: string } {
  const p = params ?? {};
  switch (title) {
    case "google":
      return p.serperApiKey
        ? { ok: true }
        : { ok: false, reason: "requires serperApiKey" };
    case "discord":
      return p.discordKey
        ? { ok: true }
        : { ok: false, reason: "requires discordKey" };
    case "postgres":
      return p.host && p.database
        ? { ok: true }
        : { ok: false, reason: "requires host and database" };
    case "database":
      return Array.isArray(p.connections) && p.connections.length > 0
        ? { ok: true }
        : { ok: false, reason: "requires connections[]" };
    case "http":
      return p.url ? { ok: true } : { ok: false, reason: "requires url" };
    case "issue":
      return p.githubToken
        ? { ok: true }
        : { ok: false, reason: "requires githubToken" };
    case "greptile":
    case "web":
    case "debugger":
      // Explicit config entry is enough; runtime may still need env tokens.
      return { ok: true };
    default:
      return { ok: true };
  }
}

export function createDefaultContextProviders(): IContextProvider[] {
  return [
    new FileFolderContextProvider({}),
    new DiffContextProvider({}),
    new ProblemsContextProvider({}),
    new RepoMapContextProvider({}),
    new TerminalContextProvider({}),
    new ProjectMemoryContextProvider({}),
  ];
}

/**
 * Merge config-defined providers with defaults, deduping by title.
 * Defaults win the slot if a title is missing; config instances keep
 * custom params when the title is already present.
 */
export function mergeContextProvidersWithDefaults(
  fromConfig: IContextProvider[],
): IContextProvider[] {
  const byTitle = new Map<string, IContextProvider>();
  for (const provider of fromConfig) {
    byTitle.set(provider.description.title, provider);
  }
  for (const provider of createDefaultContextProviders()) {
    const title = provider.description.title;
    if (!byTitle.has(title)) {
      byTitle.set(title, provider);
    }
  }
  // Stable order: defaults first, then remaining config providers
  const ordered: IContextProvider[] = [];
  const seen = new Set<string>();
  for (const title of DEFAULT_CONTEXT_PROVIDER_TITLES) {
    const provider = byTitle.get(title);
    if (provider) {
      ordered.push(provider);
      seen.add(title);
    }
  }
  for (const [title, provider] of byTitle) {
    if (!seen.has(title)) {
      ordered.push(provider);
    }
  }
  return ordered;
}

/** Full registry of built-in provider classes (core + integrations). */
export const Providers: (typeof BaseContextProvider)[] = [
  // Core defaults
  FileFolderContextProvider,
  DiffContextProvider,
  ProblemsContextProvider,
  RepoMapContextProvider,
  TerminalContextProvider,
  ProjectMemoryContextProvider,
  // Core opt-in
  CurrentFileContextProvider,
  OpenFilesContextProvider,
  ClipboardContextProvider,
  GitCommitContextProvider,
  FileTreeContextProvider,
  SearchContextProvider,
  OSContextProvider,
  URLContextProvider,
  SerialContextProvider,
  // Integrations (quarantined from defaults)
  GoogleContextProvider,
  DiscordContextProvider,
  GreptileContextProvider,
  PostgresContextProvider,
  DatabaseContextProvider,
  GitHubIssuesContextProvider,
  HttpContextProvider,
  WebContextProvider,
  DebugLocalsProvider,
];

export function contextProviderClassFromName(
  name: string,
): typeof BaseContextProvider | undefined {
  return Providers.find((cls) => cls.description.title === name);
}
