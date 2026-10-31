# @cmdflow/dom

Browser behavior for CmdFlow: keyboard and pointer routing, modal state, focus restoration, IME,
ARIA relationships, scroll coordination, and optional scoped CSS.

> **v0.2 repository API:** This API is implemented in this repository but has not been published
> yet. The currently published v0.1 package uses the earlier API.

```sh
bun add @cmdflow/dom
```

The package re-exports the common core factory and contracts, so a vanilla integration needs one
consumer import:

```ts
import { createCmdFlow, createDomController } from "@cmdflow/dom";
import "@cmdflow/dom/preset.css";

const flow = createCmdFlow({
  commands: [
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
  ],
});

const controller = createDomController(flow, { eventMode: "delegate" });
```

Use `eventMode: "delegate"` for vanilla DOM. Framework adapters use prop bindings so consumer
handlers can run first and cancel library behavior.

The controller does not render markup or subscribe to the flow. Render a snapshot, bind the
corresponding elements, then call `controller.sync(snapshot)` after those elements commit. Explicit
surface addresses keep stale frames from receiving events.

Styling choices:

```ts
import "@cmdflow/dom/reset.css";  // scoped low-specificity reset
import "@cmdflow/dom/preset.css"; // reset plus starter appearance
```

See [getting started](../../docs/getting-started.md) and [styling](../../docs/styling.md).
