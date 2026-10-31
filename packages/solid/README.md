# @cmdflow/solid

Solid-native CmdFlow primitives over the same core runtime and DOM behavior used by React and
vanilla integrations.

> **v0.2 repository API:** This API is implemented in this repository but has not been published
> yet. The currently published v0.1 package uses the earlier API.

```sh
bun add @cmdflow/solid
```

```tsx
import { Command, type CmdFlowCommandDefinition } from "@cmdflow/solid";
import "@cmdflow/solid/preset.css";

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
        <Command.List>{(item) => <Command.Item item={item} />}</Command.List>
        <Command.Empty>No commands found</Command.Empty>
      </Command.Dialog>
    </Command.Root>
  );
}
```

Use `<Command.Root flow={flow}>` for application-owned lifetime. Solid exposes the same product
concepts as React with Solid-native selectors and lifecycle bindings.

Optional learned-ranking persistence is available from `@cmdflow/solid/persistence`; importing the
entrypoint is safe during server rendering. See [persistence](../../docs/persistence.md).

See [getting started](../../docs/getting-started.md), [concepts](../../docs/concepts.md), and
[styling](../../docs/styling.md).
