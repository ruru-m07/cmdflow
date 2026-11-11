# Architecture

CmdFlow has four packages because each one owns a different runtime boundary. The dependency graph
is one-way:

```text
@cmdflow/core <- @cmdflow/dom <- @cmdflow/react
                           \- @cmdflow/solid
```

| Package | Owns | Must not own |
| --- | --- | --- |
| `@cmdflow/core` | Commands, sources, navigation, execution, forms, ranking, immutable snapshots | DOM nodes, framework lifecycles, markup, CSS |
| `@cmdflow/dom` | Keyboard and pointer routing, focus, ARIA relationships, modal behavior, element bindings | Rendering, themes, application markup |
| `@cmdflow/react` | React context, subscriptions, lifecycle bindings, headless primitives | Business rules, duplicate DOM behavior, CSS |
| `@cmdflow/solid` | Solid context, selectors, lifecycle bindings, headless primitives | Business rules, duplicate DOM behavior, CSS |

## Internal design rules

- Pure transformations remain functions.
- Stateful collaborators with a clear lifecycle or invariant use focused objects.
- `create-runtime.ts` wires collaborators together; domain logic belongs in its owning module.
- Core produces immutable snapshots. Adapters consume them and must not recreate core policy.
- DOM behavior is available as prop getters and explicit element bindings.
- Primitives forward native props and refs so consumers can replace every rendered element.
- No package injects styles, creates decorative markup, or exports CSS.
- Public exports come from a package entrypoint; internal modules are not consumer API.

The core runtime currently delegates action projection to `ActionResolver`, frame projection to
`FrameProjector`, and execution, forms, sources, and navigation to their corresponding runtime
objects. This keeps the factory focused on ownership and coordination rather than accumulating all
domain behavior in one file.

## Rendering contract

CmdFlow provides behavior and accessibility primitives, not a command-palette design. Consumers
choose the elements, composition, classes, and styling system. Stable `data-cmdflow-part` and state
attributes connect application styling to library-owned state without imposing presentation.

See [styling](styling.md) for the consumer contract and [concepts](concepts.md) for the product
model.
