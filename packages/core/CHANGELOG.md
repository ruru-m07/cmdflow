## @cmdflow/core@0.2.0

### Clean up the v0.2 command workflow API

#### Clean up the v0.2 command workflow API

Split the runtime, contracts, and framework primitives into focused modules; align React, Solid,
and DOM adapters around the same command, action, view, and source model; add clearer package and
concept documentation; and ship a monochrome Tailwind example that demonstrates the complete
workflow.

## @cmdflow/core@0.1.0

### Initial headless command-flow engine and adapters

Introduce a framework-independent command registry and state engine with nested views,
contextual action panels, guarded async sources, relevance-bounded learned ranking, and forms.

Add browser interaction bindings, optional scoped styles, fixed-height virtualization helpers,
and opt-in IndexedDB ranking persistence with fingerprinted query keys. React and Solid primitives
share the same engine and DOM controller.

This is a pre-1.0 API. Read the implementation guide for supported contracts and outstanding
browser, assistive-technology, and production-hardening gates before adoption.
