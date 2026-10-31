# CmdFlow v0.2 API

> **Status: implemented in this repository, not yet published.** This is the source of truth for
> the v0.2 contract. The currently published v0.1 packages still use the earlier API.

Start with [getting started](getting-started.md) for a first integration and [concepts](concepts.md)
for the domain model.

v0.2 has two entry paths:

1. a managed adapter root for the common case; and
2. an application-owned flow for advanced integration.

Both paths render the same headless parts and use the same command, action, view, and source model.

## Package entrypoints

Consumers import from one adapter package.

```ts
// React
import { Command, type CmdFlowCommandDefinition } from "@cmdflow/react";

// Solid
import { Command, type CmdFlowCommandDefinition } from "@cmdflow/solid";

// Vanilla DOM
import {
  createCmdFlow,
  createDomController,
  type CmdFlowCommandDefinition,
} from "@cmdflow/dom";
```

The React, Solid, and DOM packages re-export the core factory and public `CmdFlow*` contracts they
need. `@cmdflow/core` remains the direct entrypoint for framework and renderer authors.

Adapter packages also expose their own stylesheet paths:

```ts
import "@cmdflow/react/preset.css";
// or "@cmdflow/react/reset.css"
```

Optional ranking persistence follows the same one-package path:

```ts
// React
import { createIndexedDBRankingStore } from "@cmdflow/react/persistence";

// Solid
import { createIndexedDBRankingStore } from "@cmdflow/solid/persistence";

// Vanilla DOM
import { createIndexedDBRankingStore } from "@cmdflow/dom/persistence";
```

All three persistence entrypoints are safe to import during server rendering. Create and dispose
the browser store in its owning browser lifecycle.

An application should not need to import a direct dependency through a transitive package.

## Managed root

Use `commands` when one adapter root should own the flow.

```tsx
import { Command, type CmdFlowCommandDefinition } from "@cmdflow/react";
import "@cmdflow/react/preset.css";

const commands = [
  {
    id: "settings.open",
    title: "Open settings",
    action: {
      type: "run",
      id: "open",
      title: "Open settings",
      run: () => {
        window.location.assign("/settings");
      },
    },
  },
] satisfies readonly CmdFlowCommandDefinition[];

export function AppCommands() {
  return (
    <Command.Root commands={commands}>
      <Command.Trigger>Open commands</Command.Trigger>
      <Command.Dialog aria-label="Application commands">
        <Command.Input aria-label="Search commands" />
        <Command.List>
          {(item) => <Command.Item key={item.candidateId} item={item} />}
        </Command.List>
        <Command.Close>Close</Command.Close>
        <Command.Status />
      </Command.Dialog>
    </Command.Root>
  );
}
```

The managed root contract is:

- `commands` and `flow` are mutually exclusive;
- the root creates one flow for its committed lifetime;
- `commands` initializes that flow and should be stable for the root's lifetime;
- the adapter handles framework replay and cleanup safely;
- unmount releases the managed flow and its DOM controller; and
- the consumer never calls `destroy()` for a managed flow.

The initial v0.2 managed path intentionally optimizes for a command list. Applications that need
dynamic registration, shared ownership, sources, custom root views, or injected ranking services
should use the advanced path rather than expanding `Command.Root` into a configuration object.

### Managed state

The managed root can own its initial state or receive controlled state from its framework host.

| State | Uncontrolled initial value | Controlled value | Change request |
| --- | --- | --- | --- |
| Dialog visibility | `defaultOpen` | `open` | `onOpenChange` |
| Main-surface query | `defaultQuery` | `query` | `onQueryChange` |

`defaultOpen` and `defaultQuery` are read once when the managed flow is created. When `open` or
`query` is provided, the matching callback reports a requested change and the next prop value
commits it. The callbacks can also observe changes in uncontrolled mode. Action-panel queries stay
flow-owned.

```tsx
import { useState } from "react";

export function ControlledCommands() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  return (
    <Command.Root
      commands={commands}
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
    >
      {/* headless parts */}
    </Command.Root>
  );
}
```

`commands` is stable initialization input: changing the prop does not reconcile an existing managed
flow. Use an application-owned `flow` and its registration API when commands must change during the
root's lifetime. Controlled state props belong only to the managed `commands` path; an advanced
`flow` owner configures and updates the runtime directly.

## Advanced root

Use `flow` when the application owns configuration and lifetime.

```tsx
import {
  Command,
  createCmdFlow,
  type CmdFlowCommandDefinition,
  type CmdFlowResultSource,
} from "@cmdflow/react";

const commands = [
  {
    id: "projects.open",
    title: "Browse projects",
    action: {
      type: "view",
      id: "open",
      title: "Browse projects",
      view: {
        type: "list",
        id: "projects",
        title: "Projects",
        sourceIds: ["projects"],
      },
    },
  },
] satisfies readonly CmdFlowCommandDefinition[];

const sources = [
  {
    id: "projects",
    async search({ rawQuery, signal }) {
      const response = await fetch(`/api/projects?q=${encodeURIComponent(rawQuery)}`, { signal });
      const projects = (await response.json()) as Array<{ id: string; name: string }>;
      return {
        operation: "replace",
        done: true,
        items: projects.map((project) => ({
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
  },
] satisfies readonly CmdFlowResultSource[];

const flow = createCmdFlow({ commands, sources });

export function AppCommands() {
  return (
    <Command.Root flow={flow}>
      <Command.Trigger>Open commands</Command.Trigger>
      <Command.Dialog aria-label="Application commands">
        <Command.Input aria-label="Search commands" />
        <Command.List>
          {(item) => <Command.Item key={item.candidateId} item={item} />}
        </Command.List>
        <Command.Status />
      </Command.Dialog>
    </Command.Root>
  );
}
```

The advanced root contract is:

- the adapter binds and renders the supplied flow;
- the adapter does not destroy an application-owned flow;
- the host chooses whether the flow lives for a component, page, application session, or server
  request; and
- the same flow can be registered or observed outside the render tree.

`createCmdFlow` is safe to call while rendering or server rendering. Construction is effect-free;
external context subscriptions start lazily with the first `flow.subscribe(...)` or an explicit
`flow.open()`. `flow.destroy()` is idempotent.

## Canonical public names

v0.2 public contracts use searchable, namespaced names.

| Contract | v0.2 name |
| --- | --- |
| Flow options | `CmdFlowOptions` |
| Immutable snapshot | `CmdFlowSnapshot` |
| Command definition | `CmdFlowCommandDefinition` |
| Action definition | `CmdFlowActionDefinition` |
| View definition | `CmdFlowViewDefinition` |
| Form field | `CmdFlowFormField` |
| Result source | `CmdFlowResultSource` |
| Extension definition | `CmdFlowExtensionDefinition` |

Adapter packages may add framework-specific prop types, but they do not rename the shared domain
contracts.

## Command contract

A command is searchable data with an optional primary action and optional contextual actions.

```ts
interface CmdFlowCommandDefinition<TContext = unknown, TData = unknown> {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly keywords?: readonly string[];
  readonly action?: CmdFlowActionDefinition<TContext, TData>;
  readonly actions?: readonly CmdFlowActionDefinition<TContext, TData>[];
}
```

The full type also carries eligibility, ranking, payload, and source metadata. The important v0.2
boundary is that a command contains actions; it is not itself an action with optional extra fields.

## Action contract

Actions are a discriminated union.

```ts
type CmdFlowActionDefinition<TContext = unknown, TData = unknown> =
  | {
      readonly type: "run";
      readonly id: string;
      readonly title: string;
      readonly run: (
        input: CmdFlowActionRunInput<TContext, TData>,
      ) =>
        | void
        | CmdFlowActionOutcome<TContext, TData>
        | Promise<void | CmdFlowActionOutcome<TContext, TData>>;
    }
  | {
      readonly type: "submenu";
      readonly id: string;
      readonly title: string;
      readonly actions: readonly CmdFlowActionDefinition<TContext, TData>[];
    }
  | {
      readonly type: "view";
      readonly id: string;
      readonly title: string;
      readonly view: CmdFlowViewDefinition<TContext, TData>;
    };
```

Shared action fields such as visibility, enabled state, shortcut, priority, destructive
confirmation, and learning policy remain available on the appropriate variants.

## View and form contracts

Views are discriminated by `type: "list" | "detail" | "form" | "custom"`. Form fields are also a
discriminated union so a text input, checkbox, select, and other field types expose only relevant
configuration.

Render payloads stay application-owned. Framework components and DOM nodes do not enter core view
definitions.

## Source contract

`CmdFlowResultSource` supplies command definitions to list views. A source declares its query policy
and returns replace or patch batches. The flow owns debouncing, request generations, abort signals,
pagination state, and stale-result guards.

Sources do not render UI and do not mutate snapshots.

## Snapshot contract

Snapshots expose explicit surface names:

```ts
interface CmdFlowSnapshot<TData = unknown> {
  readonly mainFrames: readonly CmdFlowFrameSnapshot<TData>[];
  readonly actionFrames: readonly CmdFlowFrameSnapshot<TData>[];
  readonly mainFrame: CmdFlowFrameSnapshot<TData>;
  readonly actionFrame: CmdFlowFrameSnapshot<TData> | null;
  readonly activeFrame: CmdFlowFrameSnapshot<TData>;
}
```

There is no ambiguous `current` frame in v0.2. Narrow state changes retain references for unchanged
data, and `getSnapshot()` returns the same immutable object until a commit.

## Confirmation contract

`flow.confirm()` resolves to the confirmed `CmdFlowExecutionResult | undefined`. Confirmation
continues the original execution and preserves its execution ID rather than creating an unrelated
operation.

## Headless parts

The high-level adapter vocabulary remains compositional:

| Part | Responsibility |
| --- | --- |
| `Command.Root` | Own or bind a flow and provide adapter context. |
| `Command.Trigger` | Request that the main surface open. |
| `Command.Dialog` | Bind the outer modal surface. |
| `Command.Input` | Bind query and active-descendant behavior. |
| `Command.List` | Render the active frame's ordered items. |
| `Command.Item` | Bind one resolved item by stable identity. |
| `Command.ActionPanelTrigger` | Open contextual actions for the active command. |
| `Command.ActionPanel` | Render the independent action surface. |
| `Command.Back` | Pop the active surface. |
| `Command.Close` | Request that the flow close. |
| `Command.Status` | Render the persistent accessible status region. |
| Form and confirmation parts | Bind their corresponding view state. |

Parts accept native presentation props and refs. Required roles, IDs, and relationships remain
adapter-owned. Consumer event handlers run first and can cancel internal behavior with
`preventDefault()`.

### Element composition

`Command.Dialog`, `Command.List`, `Command.Item`, and `Command.Trigger` accept a function-based
`render(props)` prop when a design-system component should own the element. Spread every supplied
prop onto the compatible rendered element: those props carry the ref, event handlers, roles, ARIA
relationships, and CmdFlow state attributes.

```tsx
<Command.Trigger
  render={(props) => <ToolbarButton {...props} />}
>
  Open commands
</Command.Trigger>
```

`ToolbarButton` must forward its native props and ref. The adapter exports
`PrimitiveRender<Props>` for shared render helpers and wrapper component contracts. This explicit
function composition replaces the primitive's default element; it does not clone a child or rely on
implicit prop forwarding.

## Styling contract

No stylesheet is required for behavior. Each adapter exposes:

- `reset.css` for scoped normalization; and
- `preset.css` for a small starter appearance that includes the reset.

See [styling](styling.md) for imports, tokens, and state selectors.

## v0.1 to v0.2 direction

| v0.1 surface | v0.2 |
| --- | --- |
| `<Command.Root store={store}>` | `<Command.Root flow={flow}>` |
| No managed root | `<Command.Root commands={commands}>` |
| Direct core imports in adapter apps | Core factory and types re-exported by the adapter |
| `ActionDefinition` | `CmdFlowActionDefinition` with a required discriminator |
| Commands inherit action fields | `command.action` plus `command.actions` |
| `ViewDefinition` | `CmdFlowViewDefinition` with explicit view variants |
| `ResultSource`-style aliases | `CmdFlowResultSource` |
| `snapshot.current` | `mainFrame`, `actionFrame`, and `activeFrame` |
| CSS imported through `@cmdflow/dom` everywhere | CSS subpaths exposed by each adapter |

These changes are present on this repository branch but are not available to registry consumers
until the v0.2 packages are published.
