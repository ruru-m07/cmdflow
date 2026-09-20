import {
  type CmdFlow,
  type CmdFlowActionDefinition,
  type CmdFlowCommandDefinition,
  type CmdFlowResultSource,
  type CmdFlowViewDefinition,
  createCmdFlow,
} from "@cmdflow/react";
import { createIndexedDBRankingStore } from "@cmdflow/react/persistence";

export interface DemoContext {
  notify(message: string): void;
}

export interface DemoFlow {
  readonly flow: CmdFlow<DemoContext>;
  readonly ranking: ReturnType<typeof createIndexedDBRankingStore>;
  failNextRequest(): void;
  destroy(): void;
}

const githubCommands = [
  ["home", "GitHub", "Workspace overview"],
  ["stats", "GitHub · My stats", "Contribution activity"],
  ["pulls", "GitHub · My pull requests", "Browse a nested view"],
  ["issues", "GitHub · My issues", "Assigned to you"],
  ["menu", "GitHub · Pull requests menu bar", "Your open work"],
  ["notifications", "GitHub · Notifications", "Try choosing this sixth result"],
  ["create", "GitHub · Create pull request", "Open a validated form"],
  ["search", "GitHub · Search pull requests", "Async search and pagination"],
  ["stars", "GitHub · Starred repositories", "Your saved repositories"],
  ["repos", "GitHub · Browse repositories", "Recently visited"],
] as const;

const pullRequests = [
  "Preserve search when navigating back",
  "Add contextual action shortcuts",
  "Improve input composition handling",
  "Keep command ranking local",
  "Add a Solid adapter",
  "Validate pull request forms",
  "Restore focus after closing actions",
  "Make result sources cancellable",
  "Document the headless API",
];

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function createPullRequestForm(): CmdFlowViewDefinition<DemoContext> {
  return {
    id: "create-pr",
    type: "form",
    title: "Create pull request",
    description: "A native form with shared validation and preserved drafts.",
    fields: [
      {
        id: "title",
        type: "text",
        label: "Title",
        required: true,
        validate: (value) =>
          String(value).trim().length < 5
            ? "Use at least five characters for a useful title."
            : undefined,
      },
      { id: "body", label: "Description", type: "textarea", defaultValue: "" },
      {
        id: "base",
        label: "Base branch",
        type: "select",
        defaultValue: "main",
        options: [
          { value: "main", label: "main" },
          { value: "develop", label: "develop" },
        ],
      },
      { id: "draft", label: "Create as draft", type: "checkbox", defaultValue: true },
    ],
    submit: {
      type: "run",
      id: "create",
      title: "Create pull request",
      run: async ({ values, appContext, signal }) => {
        await delay(300, signal);
        appContext.notify(`Created demo pull request: ${values.title}`);
        return { type: "pop-view", target: "main" };
      },
    },
  };
}

function createPullRequestList(): CmdFlowViewDefinition<DemoContext> {
  return {
    id: "pull-requests",
    type: "list",
    title: "My pull requests",
    description: "Local async fixture · 3 results per page",
    sourceIds: ["pull-requests"],
    rankingContextKey: "pull-requests",
  };
}

function createPullRequestDetail(title: string, index: number): CmdFlowViewDefinition<DemoContext> {
  return {
    id: `pr-${index}`,
    type: "detail",
    title,
    description:
      "This local fixture shows how a command can open a richer view. Escape returns to the exact list, query, and active item.",
    actions: [
      {
        type: "run",
        id: "review",
        title: "Mark reviewed",
        run: ({ appContext }) => {
          appContext.notify(`Reviewed: ${title}`);
          return { type: "pop-view", target: "main" };
        },
      },
    ],
  };
}

function createPrimaryAction(id: string, title: string): CmdFlowActionDefinition<DemoContext> {
  if (id === "create") {
    return {
      type: "view",
      id: "open",
      title: "Create pull request",
      priority: "primary",
      target: "main",
      view: createPullRequestForm(),
    };
  }

  if (id === "pulls" || id === "search") {
    return {
      type: "view",
      id: "open",
      title: "Browse pull requests",
      priority: "primary",
      target: "main",
      view: createPullRequestList(),
    };
  }

  return {
    type: "run",
    id: "open",
    title: "Open command",
    priority: "primary",
    run: ({ appContext }) => {
      appContext.notify(`Ran ${title}. This successful choice is remembered locally.`);
      return { type: "close" };
    },
  };
}

function createContextualActions(
  id: string,
  title: string,
): readonly CmdFlowActionDefinition<DemoContext>[] {
  return [
    {
      type: "run",
      id: "copy",
      title: "Copy demo URL",
      priority: "secondary",
      shortcut: { key: "c", mod: true, shift: true },
      learn: false,
      run: async ({ appContext }) => {
        if (!navigator.clipboard)
          throw new Error("Clipboard access is unavailable in this browser.");
        await navigator.clipboard.writeText(`https://github.com/cmdflow/${id}`);
        appContext.notify("Copied the demo URL.");
        return { type: "close", target: "actions" };
      },
    },
    {
      type: "submenu",
      id: "organize",
      title: "Organize…",
      actions: [
        {
          type: "run",
          id: "pin",
          title: "Preview pin action",
          run: ({ appContext }) => {
            appContext.notify(`Pin action selected for ${title}.`);
            return { type: "close", target: "actions" };
          },
        },
        {
          type: "view",
          id: "create",
          title: "Create a related pull request",
          target: "main",
          view: createPullRequestForm(),
        },
      ],
    },
    {
      type: "run",
      id: "delete",
      title: "Preview removal",
      destructive: true,
      learn: false,
      run: ({ appContext }) => {
        appContext.notify(`Confirmed the demo removal action for ${title}.`);
        return { type: "close", target: "actions" };
      },
    },
    {
      type: "run",
      id: "admin",
      title: "Repository settings",
      enabled: () => ({ reason: "Admin permission is required in this demo." }),
      run: () => {},
    },
  ];
}

function createCommands(): readonly CmdFlowCommandDefinition<DemoContext>[] {
  return githubCommands.map(([id, title, subtitle], index) => ({
    id,
    title,
    subtitle,
    providerRank: index,
    keywords: ["github"],
    aliases: ["github"],
    action: createPrimaryAction(id, title),
    actions: createContextualActions(id, title),
  }));
}

export function createDemoFlow(notify: (message: string) => void): DemoFlow {
  const ranking = createIndexedDBRankingStore({
    databaseName: "cmdflow-demo-ranking-v1",
    queryRetention: "fingerprint",
  });
  let failNext = false;

  const sources: readonly CmdFlowResultSource<DemoContext>[] = [
    {
      id: "pull-requests",
      debounceMs: 120,
      search: async ({ rawQuery, cursor, signal }) => {
        await delay(450, signal);
        if (failNext) {
          failNext = false;
          throw new Error("The demo source failed. Retry to recover.");
        }

        const matches = pullRequests
          .map((title, index) => ({ title, index }))
          .filter(({ title }) => title.toLowerCase().includes(rawQuery.toLowerCase()));
        const start = Number(cursor ?? "0");
        return {
          operation: cursor ? "patch" : "replace",
          done: true,
          nextCursor: start + 3 < matches.length ? String(start + 3) : undefined,
          items: matches.slice(start, start + 3).map(({ title, index }) => ({
            id: String(index + 1),
            title,
            subtitle: `cmdflow/cmdflow · #${101 + index}`,
            providerRank: index,
            action: {
              type: "view",
              id: "open",
              title: "Open pull request",
              target: "main",
              view: createPullRequestDetail(title, index),
            },
          })),
        };
      },
    },
  ];

  const flow = createCmdFlow<DemoContext>({
    id: "cmdflow-demo",
    context: { notify },
    root: { id: "commands", type: "list", title: "Commands", sourceIds: [] },
    commands: createCommands(),
    ranking: {
      store: ranking,
      scope: { subjectKey: "local-demo", surfaceId: "palette" },
      queryPolicy: (scope) => ranking.getQueryPolicy(scope),
    },
    sources,
  });

  return {
    flow,
    ranking,
    failNextRequest() {
      failNext = true;
      flow.refresh();
    },
    destroy() {
      flow.destroy();
      ranking.destroy();
    },
  };
}
