# CmdFlow

CmdFlow is the framework-neutral action workflow engine for product command interfaces. Define
commands once, then compose search, nested navigation, contextual actions, forms, async sources,
and local learned ranking with React, Solid, or the DOM directly.

This repository contains the v0.2 API described below. The currently published v0.1 packages still
use the earlier low-level adapter contract; v0.2 has not been published yet.

## React quick start

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

export function AppCommands() {
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

`Command.Root` owns the flow in the common case. Pass an application-owned `flow` instead when you
need external registration, async sources, persistence, or shared lifetime.

## What CmdFlow owns

- Stable command identity, search, ranking, and active-item state
- Independent main and contextual-action navigation stacks
- Async source cancellation, pagination, and stale-result protection
- Action execution, destructive confirmation, forms, and safe drafts
- Keyboard, focus, modal, IME, and ARIA behavior through the DOM adapter

Your application owns markup composition, visual design, authorization, data fetching, and action
side effects. The preset is optional; remove it for a completely headless starting point.

## Packages

| Package | Use it for |
| --- | --- |
| `@cmdflow/react` | Managed and application-owned React command interfaces |
| `@cmdflow/solid` | The same product model with Solid-native reactivity |
| `@cmdflow/dom` | Vanilla DOM rendering and framework adapter development |
| `@cmdflow/core` | Framework-neutral flow ownership and custom renderers |

Application code should normally install and import one adapter package. Adapters re-export the
core factory and canonical `CmdFlow*` contracts needed by their consumers.

## Explore the repository

Run `bun install` and `bun run dev`, then open [http://localhost:3000](http://localhost:3000). The
demo uses only public React exports and covers async sources, action panels, nested views, forms,
confirmation, and local ranking.

## Learn the model

- [Concepts](docs/concepts.md) — commands, actions, views, sources, and flow ownership
- [Getting started](docs/getting-started.md) — React, Solid, and vanilla DOM
- [Styling](docs/styling.md) — headless, scoped reset, and starter preset paths
- [Persistence](docs/persistence.md) — opt-in learned-ranking storage and privacy
- [v0.2 API contract](docs/api-v0.2.md) — the implementation source of truth

Repository setup and architectural boundaries live in [CONTRIBUTING.md](CONTRIBUTING.md).
