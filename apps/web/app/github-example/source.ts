import type { CmdFlowResultSource } from "@cmdflow/react";
import { github } from "./definitions";
import type { GithubContext, GithubItemData } from "./types";
import { createPullRequestDetailView } from "./views";

const pullRequests = [
  "Preserve Search When Navigating Back",
  "Add Contextual Action Shortcuts",
  "Improve Input Composition Handling",
  "Keep Command Ranking Local",
  "Add a Solid Adapter",
  "Validate Pull Request Forms",
  "Restore Focus After Closing Actions",
  "Make Result Sources Cancellable",
  "Document the Headless API",
] as const;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export const pullRequestSource = github.source({
  id: "pull-requests",
  debounceMs: 120,
  search: async ({ rawQuery, cursor, signal }) => {
    await wait(300, signal);
    const matches = pullRequests
      .map((title, index) => ({ title, number: 101 + index }))
      .filter(({ title }) => title.toLowerCase().includes(rawQuery.toLowerCase()));
    const start = Number(cursor ?? "0");
    return {
      operation: cursor ? "patch" : "replace",
      done: true,
      nextCursor: start + 3 < matches.length ? String(start + 3) : undefined,
      items: matches.slice(start, start + 3).map(({ title, number }, providerRank) => ({
        id: String(number),
        title,
        subtitle: `cmdflow/cmdflow · #${number}`,
        section: "Pull Requests",
        providerRank,
        data: {
          kind: "pull-request" as const,
          icon: "↗",
          accessory: "Pull Request",
          number,
        },
        action: {
          type: "view" as const,
          id: "open",
          title: "Open Pull Request",
          priority: "primary" as const,
          target: "main" as const,
          view: createPullRequestDetailView(title, number),
        },
      })),
    };
  },
} satisfies CmdFlowResultSource<GithubContext, GithubItemData>);
