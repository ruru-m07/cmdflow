# Getting started with CmdFlow

> **v0.2 repository API:** The examples below compile against this repository. The currently
> published v0.1 packages still use the earlier API; v0.2 has not been published yet.

Choose the package for the renderer you already use:

| Application | Install |
| --- | --- |
| React | `bun add @cmdflow/react` |
| Solid | `bun add @cmdflow/solid` |
| Vanilla DOM | `bun add @cmdflow/dom` |

Each adapter package exposes the core types and factory needed by its consumers. You do not install
or import another CmdFlow package for the basic path.

## React

### 1. Define commands

```tsx
"use client";

import { Command, type CmdFlowCommandDefinition } from "@cmdflow/react";
import "@cmdflow/react/preset.css";

const commands = [
  {
    id: "inbox.open",
    title: "Open inbox",
    subtitle: "Review unread messages",
    keywords: ["mail", "notifications"],
    action: {
      type: "run",
      id: "open",
      title: "Open inbox",
      run: () => {
        window.location.assign("/inbox");
      },
    },
  },
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
```

`"use client"` is needed in a Next.js App Router component because the adapter responds to browser
input. It is not needed in a client-only React application.

### 2. Render the managed root

```tsx
export function AppCommands() {
  return (
    <Command.Root commands={commands}>
      <Command.Trigger>Open commands</Command.Trigger>

      <Command.Dialog aria-label="Application commands">
        <Command.Input aria-label="Search commands" placeholder="Search…" />
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

The managed root creates the flow, registers `commands`, and owns cleanup. Add application styling
around the parts, or keep the imported preset for a small usable default.

Treat `commands` as initialization input and keep it stable for the root's lifetime. Use
`defaultOpen` and `defaultQuery` for uncontrolled initial state, or pair `open` with
`onOpenChange` and `query` with `onQueryChange` for controlled state. Move to an application-owned
flow when commands must be registered dynamically. See the [v0.2 API](api-v0.2.md#managed-state)
for the complete contract.

### 3. Open it

The trigger opens the dialog. The search input retains DOM focus while Up and Down change the active
command. Enter runs its primary `action`. Escape closes the active surface.

## Solid

The Solid adapter uses the same definitions and part names.

```tsx
import { Command, type CmdFlowCommandDefinition } from "@cmdflow/solid";
import "@cmdflow/solid/preset.css";

const commands = [
  {
    id: "project.create",
    title: "Create project",
    action: {
      type: "run",
      id: "create",
      title: "Create project",
      run: () => {
        window.location.assign("/projects/new");
      },
    },
  },
] satisfies readonly CmdFlowCommandDefinition[];

export function AppCommands() {
  return (
    <Command.Root commands={commands}>
      <Command.Trigger>Open commands</Command.Trigger>

      <Command.Dialog aria-label="Application commands">
        <Command.Input aria-label="Search commands" placeholder="Search…" />
        <Command.List>{(item) => <Command.Item item={item} />}</Command.List>
        <Command.Close>Close</Command.Close>
        <Command.Status />
      </Command.Dialog>
    </Command.Root>
  );
}
```

The root creates one managed flow under its Solid owner. Item renderers receive reactive item data;
the adapter preserves keyed DOM identity as ordering changes.

## Vanilla DOM

The DOM adapter keeps markup ownership explicit. It re-exports the core factory so the application
still imports only `@cmdflow/dom`.

```html
<button id="command-trigger" type="button">Open commands</button>

<dialog id="command-dialog" data-cmdflow-root aria-label="Application commands">
  <input id="command-input" aria-label="Search commands" placeholder="Search…" />
  <div id="command-list"></div>
</dialog>
```

```ts
import {
  createCmdFlow,
  createDomController,
  type CmdFlowCommandDefinition,
} from "@cmdflow/dom";
import "@cmdflow/dom/preset.css";

const commands = [
  {
    id: "help.open",
    title: "Open help",
    action: {
      type: "run",
      id: "open",
      title: "Open help",
      run: () => {
        window.location.assign("/help");
      },
    },
  },
] satisfies readonly CmdFlowCommandDefinition[];

const trigger = document.querySelector<HTMLButtonElement>("#command-trigger");
const dialog = document.querySelector<HTMLDialogElement>("#command-dialog");
const input = document.querySelector<HTMLInputElement>("#command-input");
const list = document.querySelector<HTMLElement>("#command-list");

if (!trigger || !dialog || !input || !list) {
  throw new Error("CmdFlow example markup is incomplete.");
}

const flow = createCmdFlow({ commands });
const controller = createDomController(flow, { eventMode: "delegate" });
const releaseDialog = controller.bindDialog(dialog);
let releaseFrame = () => {};
let releaseItems: Array<() => void> = [];
let boundFrameId: string | undefined;

function render() {
  const snapshot = flow.getSnapshot();
  const frame = snapshot.mainFrame;
  const address = { surface: "main", frameId: frame.id } as const;

  if (boundFrameId !== frame.id) {
    releaseFrame();
    boundFrameId = frame.id;
    const releaseInput = controller.bindInput(input, address);
    const releaseList = controller.bindList(list, address);
    releaseFrame = () => {
      releaseInput();
      releaseList();
    };
  }

  for (const release of releaseItems) release();
  releaseItems = [];
  list.replaceChildren();

  for (const item of frame.items) {
    const row = document.createElement("div");
    row.textContent = item.title;
    list.append(row);
    releaseItems.push(controller.registerItem(item.candidateId, row, address));
  }

  controller.sync(snapshot);
}

const unsubscribe = flow.subscribe(render);
const open = () => flow.open();
trigger.addEventListener("click", open);
render();

export function destroyCommands() {
  trigger.removeEventListener("click", open);
  unsubscribe();
  for (const release of releaseItems) release();
  releaseFrame();
  releaseDialog();
  controller.destroy();
  flow.destroy();
}
```

Framework adapters perform the binding and cleanup shown above. The explicit DOM example is useful
when building another adapter or integrating with an application that owns its rendering loop.

## Bring your own flow

Move to the advanced path when the application needs async sources, external registration, custom
root views, persistence, or a lifetime longer than one adapter root.

```tsx
import { Command, createCmdFlow } from "@cmdflow/react";

const flow = createCmdFlow({ commands, sources });

export function AppCommands() {
  return <Command.Root flow={flow}>{/* the same headless parts */}</Command.Root>;
}
```

The host owns an injected flow and eventually calls `flow.destroy()`. The adapter only owns its DOM
controller and subscriptions.

## Choose a styling path

- Keep `preset.css` for a small starter appearance.
- Replace it with `reset.css` when the application wants complete visual ownership with normalized
  controls.
- Import neither stylesheet for a fully headless integration.

See [styling](styling.md) for tokens and state selectors.

## Next steps

- Read [concepts](concepts.md) for commands, actions, views, sources, and runtime ownership.
- Read the [v0.2 API](api-v0.2.md) before implementing advanced integrations.
- Read [learned ranking persistence](persistence.md) when preferences should survive reloads.
