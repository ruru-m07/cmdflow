# @cmdflow/react

React primitives over the shared `@cmdflow/core` store and `@cmdflow/dom` interaction controller.
Requires React 18 or newer. Components forward refs, accept native presentation/event props, and ship
without styles. Optional styles are available at `@cmdflow/dom/reset.css` and `@cmdflow/dom/preset.css`.

```tsx
import { createCmdFlow } from "@cmdflow/core";
import { Command } from "@cmdflow/react";

const flow = createCmdFlow({
  commands: [{ id: "issues", title: "My issues", run: () => openIssues() }],
});

function Palette() {
  return (
    <Command.Root store={flow}>
      <Command.Trigger>Open commands</Command.Trigger>
      <Command.Dialog aria-label="Application commands">
        <Command.Input aria-label="Search commands" />
        <Command.List>
          {(item) => <Command.Item key={item.candidateId} item={item} />}
        </Command.List>
        <Command.ActionsTrigger>Actions</Command.ActionsTrigger>
        <Command.Actions>
          <Command.Input aria-label="Search actions" />
          <Command.List>
            {(item) => <Command.Item key={item.candidateId} item={item} />}
          </Command.List>
        </Command.Actions>
        <Command.Close>Close</Command.Close>
        <Command.Status />
      </Command.Dialog>
    </Command.Root>
  );
}
```

Use one store per application session, or per request when rendering on the server. Keep the store
and optional `Root.options` object stable. The host owns the store: unmounting `Root` releases DOM
bindings and subscriptions, while `flow.destroy()` ends the actual engine lifetime. React Strict
Mode can remount bindings safely. Server rendering uses the engine's cached `getServerSnapshot`;
hydration adopts the current client snapshot after the server markup has been matched.
Dialog visibility and search text belong to the store: use `open`/`setOpen` and
`setQuery`/`syncQuery`, not native `Dialog.open` or `Input.value`/`defaultValue` props. This preserves
the native modal lifecycle and one authoritative query state.

`useCmdflowStore()` exposes the same store, `useCmdflow()` also exposes the DOM controller and
snapshot, and `useCmdflowSelector(selector, optionalStore, equality)` subscribes to a selected
snapshot value. `useCmdflowFrame(surface?)` chooses the main or actions frame. For custom elements,
`useInputProps`, `useItemProps`, and `useFieldProps` return composed React props including refs.

Consumer event handlers run first; `preventDefault()` cancels internal handling. Input text uses
`onInput`, including paste and IME composition. Required roles, IDs, and relationships are preserved;
labels, classes, and styles remain customizable. Render secondary controls outside `Command.Item`.

Forms use `Command.Form`, `FieldLabel`, `Field`, `Textarea`, `Select`, and `FieldError`. The field ID
matches the core view definition. `Select` renders the definition's options unless children are
provided. Form submission delegates validation and execution to core. `Confirmation`, `Confirm`,
and `CancelConfirmation` render the explicit destructive-action or dirty-draft confirmation state.
`Back` returns to the parent frame; inside `Actions` it acts on the independent actions stack.

Verification: `bun run test` covers SSR/hydration, refs, focus, event cancellation, exactly-once
keyboard invocation, IME, independent actions, validated forms, selector isolation, and Strict Mode.
