import type { CmdFlowViewDefinition } from "@cmdflow/react";
import { github } from "./definitions";
import type { GithubContext, GithubItemData } from "./types";

export const pullRequestListView = github.view({
  id: "pull-requests",
  type: "list",
  title: "Pull Requests",
  description: "Local async results",
  sourceIds: ["pull-requests"],
  rankingContextKey: "pull-requests",
} satisfies CmdFlowViewDefinition<GithubContext, GithubItemData>);

export const createPullRequestView = github.form({
  id: "create-pr",
  type: "form",
  title: "Create Pull Request",
  description: "Complete the pull request details.",
  fields: [
    {
      id: "title",
      type: "text",
      label: "Title",
      required: true,
      validate: (value) => (value.trim().length < 5 ? "Use at least five characters." : undefined),
    },
    { id: "body", label: "Description", type: "textarea", defaultValue: "" },
    {
      id: "base",
      label: "Base Branch",
      type: "select",
      defaultValue: "main",
      options: [
        { value: "main", label: "main" },
        { value: "develop", label: "develop" },
      ],
    },
    { id: "draft", label: "Create as Draft", type: "checkbox", defaultValue: true },
  ],
  submit: {
    type: "run",
    id: "create",
    title: "Create Pull Request",
    run: ({ values }) => {
      if (!values.title.trim()) return { type: "stay" };
      return { type: "pop-view", target: "main" };
    },
  },
});

export function createPullRequestDetailView(
  title: string,
  number: number,
): CmdFlowViewDefinition<GithubContext, GithubItemData> {
  return github.view({
    id: `pull-request-${number}`,
    type: "detail",
    title,
    description: `cmdflow/cmdflow · #${number}`,
    actions: [
      {
        type: "run",
        id: "review",
        title: "Mark Reviewed",
        priority: "primary",
        run: () => ({ type: "pop-view", target: "main" }),
      },
    ],
  });
}
