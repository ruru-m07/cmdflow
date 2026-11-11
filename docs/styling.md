# Styling CmdFlow

CmdFlow is completely headless. The packages contain no stylesheet, inject no style element, and
define no visual tokens. Applications own layout, typography, color, spacing, motion, and every
other presentation decision.

## What the primitives provide

React and Solid primitives forward `class`, `className`, `style`, native presentation props, and
refs to the rendered element. Render functions can replace the default element when an application
needs a design-system component or different markup.

The adapters expose stable attributes for behavior-owned state:

| Selector | Meaning |
| --- | --- |
| `[data-cmdflow-root]` | Boundary for one command interface. |
| `[data-cmdflow-part="…"]` | Stable part name such as `input`, `list`, or `item`. |
| `[data-state="active"]` | The current keyboard or pointer navigation target. |
| `[data-disabled="true"]` | A discoverable item that cannot be invoked. |

Use consumer classes for appearance and data attributes only for state owned by CmdFlow.

```tsx
<Command.Dialog className="commandDialog" aria-label="Application commands">
  <Command.Input className="commandInput" aria-label="Search commands" />
  <Command.List className="commandList">
    {(item) => (
      <Command.Item key={item.candidateId} item={item} className="commandItem" />
    )}
  </Command.List>
</Command.Dialog>
```

The classes may come from Tailwind, CSS Modules, vanilla CSS, CSS-in-JS, or a component library.
CmdFlow does not require or prefer any styling tool.

## Custom elements

Use a primitive's `render` contract when the application design system should own the element.
The rendered component must forward the supplied native props and ref because they carry keyboard,
focus, and ARIA behavior.

```tsx
<Command.Trigger render={(props) => <ToolbarButton {...props} />}>
  Open commands
</Command.Trigger>
```

## Interaction states

Visual design should preserve the distinction between active, selected, disabled, pending, and
destructive states.

- **Active** is the keyboard or pointer navigation target.
- **Selected** is committed application selection and is not implied by active navigation.
- **Disabled** remains discoverable but cannot execute.
- **Pending** communicates in-flight work without erasing available results.
- **Destructive** signals that confirmation may be required; color alone is not enough.

Do not put independent buttons or links inside an option. Render secondary controls outside the
item and connect them through actions.

## Accessibility requirements

Appearance must not break the adapter's behavior contract.

- Keep a visible `:focus-visible` indicator.
- Keep the status region visually hidden without removing it from the accessibility tree.
- Preserve native dialog visibility and backdrop behavior when using a dialog element.
- Keep text and state indicators legible in forced-colors mode.
- Do not use color as the only disabled, error, pending, or destructive cue.
- Ensure a custom scrolling container keeps the active item visible.

Required roles, IDs, labels, and ARIA relationships remain adapter-owned. Everything visual remains
application-owned.
