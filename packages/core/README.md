# @cmdflow/core

The framework-neutral CmdFlow runtime. Use it directly when an application owns the flow outside a
React, Solid, or DOM render tree.

> **v0.2 repository API:** This API is implemented in this repository but has not been published
> yet. The currently published v0.1 package uses the earlier API.

```sh
bun add @cmdflow/core
```

```ts
import {
  createCmdFlow,
  type CmdFlowCommandDefinition,
} from "@cmdflow/core";

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

const flow = createCmdFlow({ commands });
const unsubscribe = flow.subscribe(() => render(flow.getSnapshot()));

flow.open();

// Host teardown
unsubscribe();
flow.destroy();
```

Core owns command registration, immutable snapshots, search, independent navigation surfaces,
sources, execution, forms, and optional learned ranking. It never imports DOM or framework code.

Definitions use explicit discriminated contracts:

- commands are searchable entries with a primary `action` and contextual `actions`;
- actions are `run`, `submenu`, or `view` variants;
- views are `list`, `detail`, `form`, or `custom` variants;
- form fields encode their value shape in their field type.

See the repository [concepts](../../docs/concepts.md), [v0.2 API contract](../../docs/api-v0.2.md),
and [persistence guide](../../docs/persistence.md).
