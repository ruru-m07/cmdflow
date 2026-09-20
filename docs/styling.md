# Styling CmdFlow

> **v0.2 repository API:** Adapter-local CSS exports are implemented in this repository. The
> currently published v0.1 React and Solid packages still expose styles through `@cmdflow/dom`.

Start with [getting started](getting-started.md) to render a command interface, then return here to
choose how much visual styling CmdFlow should supply.

CmdFlow behavior does not depend on a visual theme. Choose one of three styling paths.

| Path | Import | Use when |
| --- | --- | --- |
| Headless | Nothing | The application already owns reset and component styles. |
| Scoped reset | `reset.css` | The application wants normalized controls and complete visual ownership. |
| Starter preset | `preset.css` | The application wants a usable first render before applying its design system. |

Import only one stylesheet. The preset already includes the reset.

## Starter preset

Import the preset from the adapter package already used by the application.

```ts
// React
import "@cmdflow/react/preset.css";

// Solid
import "@cmdflow/solid/preset.css";

// Vanilla DOM
import "@cmdflow/dom/preset.css";
```

The preset supplies a compact dialog, input, scrollable list, active item, disabled state, form
controls, focus indication, system colors, and forced-color support. It is a starting point, not a
fixed CmdFlow brand theme.

Override its tokens on a CmdFlow root:

```css
.productCommands {
  --cmdflow-background: #101210;
  --cmdflow-foreground: #f4f5f0;
  --cmdflow-border: #343832;
  --cmdflow-active: #293326;
}
```

```tsx
<Command.Dialog className="productCommands" aria-label="Application commands">
  {/* parts */}
</Command.Dialog>
```

The initial token contract is intentionally small:

| Token | Purpose |
| --- | --- |
| `--cmdflow-background` | Root and dialog background. |
| `--cmdflow-foreground` | Default text and control color. |
| `--cmdflow-border` | Dialog and control borders. |
| `--cmdflow-active` | Active command background. |

Applications may define additional private tokens, but should not rely on undocumented internal
values from the preset.

## Scoped reset

Use the reset when the product supplies every visual style but wants predictable sizing, inherited
control typography, pointer behavior, focus visibility, and reduced-motion normalization.

```ts
import "@cmdflow/react/reset.css";
```

The reset is scoped beneath `[data-cmdflow-root]`. It must not change controls elsewhere in the
application.

## Fully headless

Import no CmdFlow stylesheet. Parts forward `className`, `style`, native presentation props, and
refs to their rendered elements.

CmdFlow exposes stable selectors for behavior state:

| Selector | Meaning |
| --- | --- |
| `[data-cmdflow-root]` | Boundary for one rendered command interface. |
| `[data-cmdflow-part="…"]` | Stable part name such as `input`, `list`, or `item`. |
| `[data-state="active"]` | The item referenced by the input's active descendant. |
| `[data-disabled="true"]` | A discoverable item that cannot be invoked. |

Prefer consumer classes for layout and brand styling. Use data attributes for state that CmdFlow
owns.

```css
.commandDialog {
  width: min(38rem, calc(100vw - 2rem));
  padding: 0;
  overflow: hidden;
  color: var(--panel-text);
  background: var(--panel-background);
  border: 1px solid var(--panel-border);
  border-radius: 0.75rem;
}

.commandInput {
  width: 100%;
  padding: 1rem;
  color: inherit;
  background: transparent;
  border: 0;
  outline: 0;
}

.commandItem {
  padding: 0.625rem 0.75rem;
  border-radius: 0.375rem;
}

.commandItem[data-state="active"] {
  background: var(--panel-active);
}

.commandItem[data-disabled="true"] {
  opacity: 0.55;
}
```

```tsx
<Command.Dialog className="commandDialog" aria-label="Application commands">
  <Command.Input className="commandInput" aria-label="Search commands" />
  <Command.List>
    {(item) => (
      <Command.Item key={item.candidateId} item={item} className="commandItem" />
    )}
  </Command.List>
</Command.Dialog>
```

## Cascade and import order

Reset and preset rules live in named cascade layers and use low-specificity `:where(...)`
selectors. Ordinary unlayered application CSS overrides them without specificity escalation.

When the application has its own layer order, declare CmdFlow layers before application component
layers:

```css
@layer cmdflow-reset, cmdflow-preset, components;
@import "@cmdflow/react/preset.css";

@layer components {
  .commandItem[data-state="active"] {
    background: var(--product-selection);
  }
}
```

In Next.js, import the selected stylesheet from a client entry or layout allowed to load global CSS.
Because selectors are scoped to CmdFlow roots, the stylesheet can be loaded once for the
application.

## Interaction states

Visual styling must preserve the distinction between active, selected, disabled, pending, and
destructive states.

- **Active** is the keyboard or pointer navigation target.
- **Selected** is committed application selection and is not implied by active navigation.
- **Disabled** remains discoverable but cannot execute.
- **Pending** communicates an in-flight action or source without erasing available results.
- **Destructive** signals that confirmation may be required; color alone is not enough.

Do not place independent buttons or links inside an option. Render secondary controls outside the
`Command.Item` option and connect them through actions.

## Focus and accessibility

Styles may change appearance, never the adapter's behavior contract.

- Keep a visible `:focus-visible` indicator.
- Do not remove or visually expose the status region by accident.
- Preserve native dialog visibility and backdrop behavior.
- Keep text and state indicators legible in forced-colors mode.
- Do not use color as the only disabled, error, pending, or destructive cue.
- Ensure custom list scrolling keeps the active item visible.

Required roles, IDs, labels, and ARIA relationships remain adapter-owned even in the fully
headless path.

## Motion

A command palette is a high-frequency keyboard surface. Opening, closing, query updates, and active
item navigation should be immediate. Avoid decorative motion on those paths.

If the surrounding product adds transitions:

- animate only opacity or transform;
- keep button press feedback subtle and short;
- avoid transitions that delay focus or invocation; and
- remove spatial movement under `prefers-reduced-motion`.

The starter preset should remain useful without animation.
