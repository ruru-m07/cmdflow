# CmdFlow concepts

> **v0.2 repository API:** This document describes the implementation in this repository. The
> currently published v0.1 packages still use the earlier contract.

For a first integration, begin with [getting started](getting-started.md). For normative target
names and ownership rules, see the [v0.2 API](api-v0.2.md).

CmdFlow lets an application define commands once, run them through a framework-neutral flow, and
render them with accessible headless adapters.

The authoring model has four concepts: **command**, **action**, **view**, and **source**. A **flow**
is the runtime that coordinates them.

```text
source ──produces──> command ──offers──> action ──may open──> view
                        │                                  │
                        └──────── lives in a view <────────┘

                      CmdFlow runtime
       query · active item · navigation · execution · ranking
```

## 1. Command

A command is a searchable item the user can discover and act on. It has a stable application ID,
visible text, an optional primary action, and optional contextual actions.

```ts
import type { CmdFlowCommandDefinition } from "@cmdflow/react";

const settingsCommand = {
  id: "settings.open",
  title: "Open settings",
  subtitle: "Manage account and workspace preferences",
  keywords: ["preferences", "profile"],
  action: {
    type: "run",
    id: "open",
    title: "Open settings",
    run: () => {
      window.location.assign("/settings");
    },
  },
} satisfies CmdFlowCommandDefinition;
```

Identity is explicit. An ID is not derived from rendered text, array position, or framework
component identity. This lets CmdFlow preserve the active command while search results reorder or
arrive asynchronously.

## 2. Action

An action describes what can happen to a command or view. v0.2 actions are discriminated by
`type`, so their behavior is visible from their data shape.

| Type | Purpose |
| --- | --- |
| `run` | Execute application work and return an outcome. |
| `submenu` | Open a nested set of contextual actions. |
| `view` | Open a list, detail, form, or custom view. |

```ts
import type { CmdFlowActionDefinition } from "@cmdflow/react";

const actions = [
  {
    type: "run",
    id: "copy-url",
    title: "Copy URL",
    run: async () => {
      await navigator.clipboard.writeText(location.href);
    },
  },
  {
    type: "submenu",
    id: "organize",
    title: "Organize",
    actions: [
      {
        type: "run",
        id: "pin",
        title: "Pin",
        run: () => pinCurrentItem(),
      },
    ],
  },
] satisfies readonly CmdFlowActionDefinition[];
```

Use `command.action` for the primary action invoked from the main result list. Use
`command.actions` for additional contextual choices. A command does not inherit an ambiguous bag
of optional action fields.

## 3. View

A view is one frame of work inside CmdFlow. v0.2 views are discriminated by `type`.

| Type | Purpose |
| --- | --- |
| `list` | Search and navigate commands or source results. |
| `detail` | Present richer information and related actions. |
| `form` | Collect and validate fields before running an action. |
| `custom` | Carry application-owned data for an application-owned renderer. |

```ts
import type { CmdFlowViewDefinition } from "@cmdflow/react";

const projectView = {
  type: "list",
  id: "projects",
  title: "Projects",
  sourceIds: ["projects"],
} satisfies CmdFlowViewDefinition;
```

CmdFlow maintains two independent surfaces:

- `main` contains the primary workflow: root list, nested lists, details, forms, and custom views.
- `actions` contains contextual actions and their submenus.

Opening an action submenu does not replace the main view. Returning from either surface restores
that surface's query, active command, and navigation frame.

## 4. Source

A source produces commands for a list view. It can return one batch, stream several batches, or
page through results. The flow owns request generations and cancellation so stale work cannot
replace newer results.

```ts
import type { CmdFlowResultSource } from "@cmdflow/react";

const projectSource = {
  id: "projects",
  async search({ rawQuery, signal }) {
    const response = await fetch(`/api/projects?q=${encodeURIComponent(rawQuery)}`, { signal });
    const projects = await response.json();

    return {
      operation: "replace",
      done: true,
      items: projects.map((project: { id: string; name: string }) => ({
        id: project.id,
        title: project.name,
        action: {
          type: "run",
          id: "open",
          title: "Open project",
          run: () => openProject(project.id),
        },
      })),
    };
  },
} satisfies CmdFlowResultSource;
```

Sources return command definitions. Rendering remains the adapter's job.

## The flow runtime

`createCmdFlow(options)` creates the framework-neutral runtime. It owns registration, immutable
snapshots, search, navigation, execution, and optional ranking state.

The v0.2 snapshot names state their scope explicitly:

- `mainFrames` and `actionFrames` are the navigation stacks;
- `mainFrame` and `actionFrame` are their active frames;
- `activeFrame` is the frame currently receiving interaction.

The managed adapter path creates and owns this runtime for ordinary command lists:

```tsx
<Command.Root commands={commands}>{/* headless parts */}</Command.Root>
```

The advanced path accepts an application-owned runtime:

```tsx
const flow = createCmdFlow({ commands, sources });

<Command.Root flow={flow}>{/* headless parts */}</Command.Root>
```

Use the managed path until the application needs to share a flow, register extensions outside the
render tree, inject persistence, or control its lifetime directly.

## Package boundary

Application code should normally import one adapter package.

| Host | Consumer entrypoint |
| --- | --- |
| React | `@cmdflow/react` |
| Solid | `@cmdflow/solid` |
| Vanilla DOM | `@cmdflow/dom` |
| Framework or renderer author | `@cmdflow/core` |

In v0.2, adapters re-export the core factory and canonical `CmdFlow*` types needed by their
consumers. React and Solid applications should not need direct imports from transitive packages.

The dependency direction remains:

```text
@cmdflow/core  <-  @cmdflow/dom  <-  @cmdflow/react
                              \-  @cmdflow/solid
```

Core never owns DOM nodes or framework components. Adapters never redefine search, navigation,
execution, or ranking policy.

Next, choose the [headless, reset, or preset styling path](styling.md).
