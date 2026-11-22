import type { CmdFlowActionDefinition, CmdFlowCommandDefinition } from "@cmdflow/react";
import {
  Bell,
  BookOpen,
  CircleDot,
  Clipboard,
  FolderGit2,
  GitPullRequest,
  type LucideIcon,
  MessageCircle,
  Moon,
  Power,
  Smile,
} from "lucide-react";
import { github } from "./definitions";
import { registerCommandIcon } from "./icons";
import type { GithubContext, GithubItemData, GithubItemKind } from "./types";
import { createPullRequestView, pullRequestListView } from "./views";

type GithubCommand = CmdFlowCommandDefinition<GithubContext, GithubItemData>;

interface ExampleCommand {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly section: string;
  readonly kind?: Exclude<GithubItemKind, "pull-request">;
  readonly icon?: string | LucideIcon;
  readonly primary?: CmdFlowActionDefinition<GithubContext, GithubItemData>;
}

function contextualActions(
  id: string,
): readonly CmdFlowActionDefinition<GithubContext, GithubItemData>[] {
  return [
    {
      type: "run",
      id: "copy-url",
      title: "Copy URL",
      priority: "secondary",
      shortcut: { key: "c", mod: true, shift: true },
      learn: false,
      run: async () => {
        if (!navigator.clipboard) throw new Error("Clipboard access is unavailable.");
        await navigator.clipboard.writeText(`https://github.com/cmdflow/${id}`);
        return { type: "close", target: "actions" };
      },
    },
    {
      type: "view",
      id: "create-related",
      title: "Create Related Pull Request",
      target: "main",
      view: createPullRequestView,
    },
    {
      type: "run",
      id: "remove",
      title: "Remove",
      destructive: true,
      learn: false,
      run: () => ({ type: "close", target: "actions" }),
    },
  ];
}

function exampleCommand({
  id,
  title,
  subtitle,
  section,
  kind = "command",
  icon = "⌘",
  primary,
}: ExampleCommand): GithubCommand {
  const action =
    primary ??
    ({
      type: "run",
      id: "open",
      title:
        kind === "application"
          ? "Open Application"
          : kind === "quicklink"
            ? "Open Link"
            : "Open Command",
      priority: "primary",
      run: () => ({ type: "close" }),
    } satisfies CmdFlowActionDefinition<GithubContext, GithubItemData>);

  return {
    id,
    title,
    subtitle,
    section,
    keywords: [section.toLowerCase(), kind],
    aliases: [title],
    data: {
      kind,
      icon: typeof icon === "string" ? icon : registerCommandIcon(id, icon),
      accessory: kind === "quicklink" ? "Quicklink" : kind,
    },
    action,
    actions: contextualActions(id),
  };
}

const commandDefinitions = [
  exampleCommand({
    id: "paste-screenshot",
    title: "Paste Recent Screenshot",
    subtitle: "Screenshots",
    section: "Favorites",
    icon: Clipboard,
  }),
  exampleCommand({
    id: "toggle-appearance",
    title: "Toggle System Appearance",
    subtitle: "System",
    section: "Favorites",
    icon: Moon,
  }),
  exampleCommand({
    id: "shut-down",
    title: "Shut Down",
    subtitle: "System",
    section: "Suggestions",
    icon: Power,
    primary: {
      type: "run",
      id: "shut-down",
      title: "Shut Down",
      priority: "primary",
      destructive: true,
      run: () => ({ type: "close" }),
    },
  }),
  exampleCommand({
    id: "whatsapp",
    title: "WhatsApp",
    subtitle: "Messaging",
    section: "Suggestions",
    kind: "application",
    icon: MessageCircle,
  }),
  exampleCommand({
    id: "emoji",
    title: "Search Emoji & Symbols",
    subtitle: "Raycast",
    section: "Suggestions",
    icon: Smile,
  }),
  exampleCommand({
    id: "create",
    title: "Create Pull Request",
    subtitle: "GitHub",
    section: "Suggestions",
    icon: GitPullRequest,
    primary: {
      type: "view",
      id: "open",
      title: "Create Pull Request",
      priority: "primary",
      target: "main",
      view: createPullRequestView,
    },
  }),
  exampleCommand({
    id: "pulls",
    title: "My Pull Requests",
    subtitle: "Browse Pull Requests",
    section: "GitHub",
    icon: GitPullRequest,
    primary: {
      type: "view",
      id: "open",
      title: "Browse Pull Requests",
      priority: "primary",
      target: "main",
      view: pullRequestListView,
    },
  }),
  exampleCommand({
    id: "issues",
    title: "My Issues",
    subtitle: "Assigned to You",
    section: "GitHub",
    icon: CircleDot,
  }),
  exampleCommand({
    id: "notifications",
    title: "Notifications",
    subtitle: "Recent Activity",
    section: "GitHub",
    icon: Bell,
  }),
  exampleCommand({
    id: "docs",
    title: "Open CmdFlow Documentation",
    subtitle: "cmdflow.dev",
    section: "Quicklinks",
    kind: "quicklink",
    icon: BookOpen,
  }),
  exampleCommand({
    id: "repos",
    title: "Browse Repositories",
    subtitle: "Recently Visited",
    section: "Quicklinks",
    kind: "quicklink",
    icon: FolderGit2,
  }),
] satisfies readonly GithubCommand[];

export const githubCommands = github.commands(
  commandDefinitions.map((command, providerRank) => ({
    ...command,
    providerRank,
    personalize: false,
  })),
);
