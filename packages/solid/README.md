# @cmdflow/solid

Solid 1.9 primitives over the same `@cmdflow/core` store and `@cmdflow/dom` controller used by the
React and vanilla adapters. This package emits plain JavaScript using Solid's `createComponent` and
`Dynamic`; consumers do not need a special compiler step for library source.

```tsx
import { createCmdFlow } from "@cmdflow/core";
import { Command } from "@cmdflow/solid";

const flow = createCmdFlow({
  commands: [{ id: "issues", title: "My issues", run: () => openIssues() }],
});

function Palette() {
  return (
    <Command.Root store={flow}>
      <Command.Trigger>Open commands</Command.Trigger>
      <Command.Dialog aria-label="Application commands">
        <Command.Input aria-label="Search commands" />
        <Command.List>{(item) => <Command.Item item={item} />}</Command.List>
        <Command.ActionsTrigger>Actions</Command.ActionsTrigger>
        <Command.Actions>
          <Command.Input aria-label="Search actions" />
          <Command.List>{(item) => <Command.Item item={item} />}</Command.List>
        </Command.Actions>
        <Command.Close>Close</Command.Close>
        <Command.Status />
      </Command.Dialog>
    </Command.Root>
  );
}
```

Keep a store stable for the lifetime of its `Root`. On unmount the adapter releases its bindings and
subscription; the host calls `flow.destroy()` when the engine itself is no longer needed. Create
stores per request for SSR. Server rendering reads `getServerSnapshot`; client mounting immediately
subscribes and reconciles with `getSnapshot`.
Dialog visibility and search text belong to the store: use `open`/`setOpen` and
`setQuery`/`syncQuery`, not native `Dialog.open` or `Input.value`/`defaultValue` props. This preserves
the native modal lifecycle and one authoritative query state.

`createCmdflow(store, options?)` creates a low-level binding under a Solid owner. `useCmdflow()`
returns the current binding: `{ store, controller, snapshot }`, with `snapshot` a Solid accessor.
`createCmdflowSelector(selector, optionalBinding, equality)` returns a memoized selected accessor;
`createCmdflowFrame(surface?)` returns a frame accessor. `createInputProps`, `createItemProps`, and
`createFieldProps` return reactive prop objects with lifecycle-aware refs for custom elements.

Consumer handlers run first and may cancel internal handling with `preventDefault()`. Native Solid
handler functions and `[handler, data]` event forms are supported. The list keys rows by candidate
identity and preserves DOM nodes when only the active item changes. Required ARIA relationships are
preserved, while labels, classes, and styles are customizable.

The list renderer receives `(item, index)`, where `item` exposes reactive fields and `index` is a
Solid accessor. Read `index()` inside JSX when displaying a position so it follows learned reordering.

The form and navigation primitives match the React adapter: `Back`, `Form`, `Field`, `Textarea`,
`Select`, `FieldLabel`, `FieldError`, `Confirmation`, `Confirm`, and `CancelConfirmation`. No search,
ranking, navigation, or execution policy is duplicated in this adapter.

`bun run test` runs browser-condition conformance tests and a separate server-condition SSR test.
Browser tests verify shared-store keyboard execution, active descendants, DOM row preservation,
frame rebinding, action isolation, handler cancellation, and subscription cleanup.
The native fixture at `e2e/solid.spec.ts` additionally passes keyboard/query/invocation, contextual
submenus/confirmation, validated forms/draft preservation, and disposal in Chromium, Firefox, and
WebKit. This is automated interaction coverage, not a manual screen-reader certification.
