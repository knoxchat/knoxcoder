import type { LucideIcon } from "lucide-react";
import {
  Bot,
  CircleDot,
  GitCommit,
  GitPullRequest,
  Globe,
  ListTodo,
  Minimize2,
  Newspaper,
  ScanSearch,
  Share2,
  Terminal,
  Trash2,
  Wand2,
} from "lucide-react";

import {
  ChipAIIcon,
  ClipboardDocumentIcon,
  CodeIcon,
  DatabaseIcon,
  DebuggerIcon,
  DeleteIcon,
  DocIcon,
  FilesIcon,
  FolderIcon,
  FolderOpenIcon,
  GitDiffIcon,
  GlobeAltIcon,
  MagnifyingGlassIcon,
  PostgresIcon,
  ProblemsIcon,
  PromptIcon,
  TerminalIcon,
  TreeIcon,
} from "../../svg-icons";
import { DiscordIcon } from "../svg/DiscordIcon";
import { GoogleIcon } from "../svg/GoogleIcon";

function lucideDropdownIcon(Icon: LucideIcon) {
  const LucideDropdownIcon = ({
    className,
    height = "1.2em",
    width = "1.2em",
    size,
  }: {
    className?: string;
    height?: string | number;
    width?: string | number;
    size?: string | number;
  }) => (
    <Icon
      className={className}
      width={width ?? size}
      height={height ?? size}
      strokeWidth={1.75}
    />
  );
  LucideDropdownIcon.displayName = Icon.displayName ?? Icon.name;
  return LucideDropdownIcon;
}

const slashCommandIcons: {
  [key: string]: ReturnType<typeof lucideDropdownIcon>;
} = {
  autonomous: lucideDropdownIcon(Bot),
  issue: lucideDropdownIcon(CircleDot),
  share: lucideDropdownIcon(Share2),
  cmd: lucideDropdownIcon(Terminal),
  http: lucideDropdownIcon(Globe),
  commit: lucideDropdownIcon(GitCommit),
  review: lucideDropdownIcon(ScanSearch),
  pr: lucideDropdownIcon(GitPullRequest),
  changelog: lucideDropdownIcon(Newspaper),
  skills: lucideDropdownIcon(Wand2),
  plan: lucideDropdownIcon(ListTodo),
  compact: lucideDropdownIcon(Minimize2),
  clear: lucideDropdownIcon(Trash2),
};

export const NAMED_ICONS: { [key: string]: any } = {
  file: FilesIcon,
  code: CodeIcon,
  terminal: TerminalIcon,
  diff: GitDiffIcon,
  search: MagnifyingGlassIcon,
  url: GlobeAltIcon,
  open: FolderOpenIcon,
  problems: ProblemsIcon,
  folder: FolderIcon,
  docs: DocIcon,
  web: GlobeAltIcon,
  clipboard: ClipboardDocumentIcon,
  database: DatabaseIcon,
  postgres: PostgresIcon,
  debugger: DebuggerIcon,
  os: ChipAIIcon,
  tree: TreeIcon,
  "prompt-files": PromptIcon,
  "repo-map": FolderIcon,
  discord: DiscordIcon,
  google: GoogleIcon,
  trash: DeleteIcon,
  ...slashCommandIcons,
  ...Object.fromEntries(
    Object.entries(slashCommandIcons).map(([name, icon]) => [`/${name}`, icon]),
  ),
};

/** Resolve a slash-command or context-provider icon by id, with or without `/`. */
export function getNamedIcon(id: string | undefined) {
  if (!id) {
    return undefined;
  }
  return (
    NAMED_ICONS[id] ??
    NAMED_ICONS[id.startsWith("/") ? id.slice(1) : `/${id}`]
  );
}
