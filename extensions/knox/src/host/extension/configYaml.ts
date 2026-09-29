/**
 * KN-356: vscode-free config.yaml watcher + `uses:` document-link helpers.
 *
 * `~/.knoxcoder/config.yaml` lives outside the workspace, so the host polls with
 * `fs.watchFile` (interval 1s) and reloads Core. YAML `uses:` slugs become
 * document links to knox.chat.
 */

export const CONFIG_YAML_WATCH_INTERVAL_MS = 1000;
export const CONFIG_YAML_USES_HREF_BASE = "https://knox.chat/";
export const CONFIG_YAML_USES_PATTERN = /^\s*#?\s*-\s*uses:\s*(.+)$/;
export const CONFIG_YAML_LANGUAGE = "yaml";

export interface ConfigYamlWatchStats {
  size: number;
}

export interface ConfigYamlUsesLink {
  slug: string;
  start: number;
  end: number;
  href: string;
}

export interface ConfigYamlUsesLinkOnLine extends ConfigYamlUsesLink {
  line: number;
}

export function shouldReloadConfigFromWatch(stats: ConfigYamlWatchStats): boolean {
  return stats.size > 0;
}

export function isKnoxConfigYamlPath(filePath: string): boolean {
  return /(^|[\\/])config\.ya?ml$/i.test(filePath);
}

export function pathsReferToSameFile(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalize(left).toLowerCase() === normalize(right).toLowerCase();
}

export function parseConfigYamlUsesLink(line: string): ConfigYamlUsesLink | undefined {
  const match = CONFIG_YAML_USES_PATTERN.exec(line);
  if (!match) {
    return undefined;
  }
  const slug = match[1].trim();
  if (!slug) {
    return undefined;
  }
  const start = line.indexOf(slug);
  if (start < 0) {
    return undefined;
  }
  return {
    slug,
    start,
    end: start + slug.length,
    href: `${CONFIG_YAML_USES_HREF_BASE}${slug}`,
  };
}

export function collectConfigYamlUsesLinks(
  lines: readonly string[],
): ConfigYamlUsesLinkOnLine[] {
  const links: ConfigYamlUsesLinkOnLine[] = [];
  for (let line = 0; line < lines.length; line++) {
    const parsed = parseConfigYamlUsesLink(lines[line] ?? "");
    if (parsed) {
      links.push({ ...parsed, line });
    }
  }
  return links;
}

export function watchConfigYamlFile(
  configPath: string,
  watchFile: (
    filename: string,
    options: { interval: number },
    listener: (stats: ConfigYamlWatchStats) => void,
  ) => void,
  unwatchFile: (filename: string) => void,
  onChange: () => void | Promise<void>,
): { dispose(): void } {
  const listener = (stats: ConfigYamlWatchStats) => {
    if (!shouldReloadConfigFromWatch(stats)) {
      return;
    }
    void onChange();
  };
  watchFile(configPath, { interval: CONFIG_YAML_WATCH_INTERVAL_MS }, listener);
  return {
    dispose() {
      unwatchFile(configPath);
    },
  };
}
