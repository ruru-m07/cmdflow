# @cmdflow/react

Headless React primitives for CmdFlow. The common path owns its runtime and requires one package.

> **v0.2 repository API:** This API is implemented in this repository but has not been published
> yet. The currently published v0.1 package uses the earlier API.

```sh
bun add @cmdflow/react
```

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
      run: () => window.location.assign("/settings"),
    },
  },
] satisfies readonly CmdFlowCommandDefinition[];

export function CommandPalette() {
  return (
    <Command.Root commands={commands}>
      <Command.Trigger>Open commands</Command.Trigger>
      <Command.Dialog aria-label="Application commands">
        <Command.Input placeholder="Search commands…" />
        <Command.List>
          {(item) => <Command.Item key={item.candidateId} item={item} />}
        </Command.List>
        <Command.Empty>No commands found</Command.Empty>
      </Command.Dialog>
    </Command.Root>
  );
}
```

## Managed state

`commands` is stable initialization input. The managed root reads it when it creates the flow and
does not reconcile later prop changes. Use an application-owned `flow` when commands must be
registered or removed during the root's lifetime.

| State | Uncontrolled initial value | Controlled value | Change request |
| --- | --- | --- | --- |
| Dialog visibility | `defaultOpen` | `open` | `onOpenChange` |
| Main-surface query | `defaultQuery` | `query` | `onQueryChange` |

```tsx
import { useState } from "react";

export function ControlledCommandPalette() {
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

`defaultOpen` and `defaultQuery` are read once. A controlled callback reports the requested change;
the next `open` or `query` prop commits it. Action-panel query state remains flow-owned. These state
props are exclusive to the managed `commands` path; an advanced `flow` owner updates its runtime
directly.

## Compose rendered elements

`Command.Dialog`, `Command.List`, `Command.Item`, and `Command.Trigger` support function-based
element composition:

```tsx
<Command.Trigger render={(props) => <ToolbarButton {...props} />}>
  Open commands
</Command.Trigger>
```

The supplied props include CmdFlow's ref, event handlers, roles, ARIA relationships, and state
attributes, so the rendered component must forward all native props and the ref. `PrimitiveRender`
is exported for typing reusable render helpers. The function replaces the primitive's default
element; CmdFlow does not clone a child or rely on implicit prop forwarding.

Use `<Command.Root flow={flow}>` when the application owns registration, sources, ranking services,
or runtime lifetime. Advanced consumers can compose with `useCmdFlow`, `useCmdFlowSelector`,
`useCommandFrame`, and the prop hooks.

The adapter also provides state-aware `Group`, `Empty`, `Loading`, `Error`, `LoadMore`, `View`,
`ActionPanel`, form, selection, and confirmation primitives. They present core state without
duplicating core policy.

Optional learned-ranking persistence is available from `@cmdflow/react/persistence`; importing the
entrypoint is safe during server rendering. See [persistence](../../docs/persistence.md).

See [getting started](../../docs/getting-started.md), [concepts](../../docs/concepts.md), and
[styling](../../docs/styling.md).
