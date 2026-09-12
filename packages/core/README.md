# @cmdflow/core

Framework-independent registration, query/ranking, nested navigation, contextual actions,
async sources, and form coordination. No DOM or framework imports. See the exported types for
the current pre-release contract; `docs/architecture.md` describes the longer-term direction.

```ts
import { createCmdFlow, createContextStore } from "@cmdflow/core";

const context = createContextStore({ connected: true });
const flow = createCmdFlow({
  id: "workspace-commands",
  context,
  root: { id: "root", type: "list", sourceIds: [] },
  commands: [{
    id: "github.issues",
    title: "My GitHub issues",
    enabled: ({ appContext }) => appContext.connected || { reason: "Connect GitHub first" },
    actions: [{
      id: "open",
      title: "Open issues",
      priority: "primary",
      run: () => ({
        type: "push-view",
        view: { id: "issues", type: "list", title: "Issues", sourceIds: ["issues"] },
      }),
    }],
  }],
  sources: [{
    id: "issues",
    debounceMs: 120,
    remoteQuery: "raw",
    async search({ rawQuery, signal }) {
      const response = await fetch(`/api/issues?q=${encodeURIComponent(rawQuery)}`, { signal });
      if (!response.ok) throw new Error("Could not load issues");
      const rows: { id: string; title: string }[] = await response.json();
      return { operation: "replace", items: rows, done: true };
    },
  }],
});

const unsubscribe = flow.subscribe(() => render(flow.getSnapshot()));
flow.open();
flow.setQuery("github");
const frame = flow.getSnapshot().current;
await flow.invoke({ address: { surface: frame.surface, frameId: frame.id } });
// Cleanup belongs to the host, not a framework render/effect replay.
unsubscribe();
flow.destroy();
```

`render` above stands for your adapter/renderer. Use `@cmdflow/dom`, `@cmdflow/react`, or
`@cmdflow/solid` for browser interaction instead of rebuilding keyboard and ARIA handling.
The root's empty `sourceIds` keeps the remote source inactive until the Issues view is entered.
That source explicitly opts into receiving the raw query; choose a different `remoteQuery` policy
if queries should be normalized or withheld from the transport.

## Behavioral contracts

- `getSnapshot()` returns the same immutable object until a commit. `getServerSnapshot()` is a
  cached initial snapshot for hydration. Data entering definitions must be plain, immutable data;
  keep DOM nodes, class instances, and renderable components outside the engine.
- IDs are stable application identities. Use `createCandidateId(sourceId, itemId)` for composite
  IDs, never array indices. `registry` and `view:*` are reserved internal source namespaces.
- Registration is atomic; duplicate extension, command, or source IDs throw without altering the
  first registration. Disposers are idempotent and abort owned in-flight work.
- Main view and contextual action stacks are distinct. Back restores the existing frame with its
  query, selection, scroll anchor, and draft. Use `openActions()` for the selected item's actions.
- Disabled results remain keyboard-discoverable but cannot invoke or join selection. Dynamic
  visibility/enabled predicates are reevaluated at invocation; this is UX gating, not authorization.
- `invoke()` without an address can run application work, but its navigation/close outcome is
  ignored. DOM/framework bindings supply an explicit live frame address automatically.
- Async work captures its origin session/frame and a cancellation signal. Removed contributions,
  obsolete requests, closed panels, or popped frames cannot redirect a newer view. `detached`
  actions may continue external work but do not gain ownership of a newer session.
- Promise/synchronous sources must emit `done: true`. Async iterators may stream replace/patch
  batches and finish with an explicit terminal batch. Pagination uses patch batches and opaque
  cursors; failures preserve previous pages. Transport cancellation is advisory: guard results too.
- Only successful, learnable invocations create ranking feedback. Highlight, hover, arrow/back navigation,
  failure, cancellation, and form field text are not positive feedback. Text relevance bands bound
  personalization. Persistence/fingerprinting cannot delay the action's UI outcome.
  Opening an action submenu does not count unless its definition explicitly sets `learn: true`.
- Default history is in-memory. For durable, fingerprinted query learning use the opt-in browser
  store described in [persistence](../../docs/persistence.md). Use `resetRanking()` for user-facing
  history controls; scope separate users/workspaces explicitly.
- Forms support async validators, dirty-discard confirmation, and explicit safe draft export/
  restore. Password/sensitive fields never appear in exported drafts. Drafts are not automatically
  persisted. The host still owns server validation and its authorization rules.
- Controlled `open`/`query` emit requests through callbacks; apply host values with `setOpen`/
  `syncQuery`. `setOpen` is authoritative and bypasses dirty-discard prompting.
- `onDiagnostic`/`onEvent` expose operation IDs and statuses, not raw query values by default.
  Host-thrown error messages may contain private data: sanitize before external telemetry.

## Verification

`bun run test` inside this package runs engine, ranking, and lifecycle fixtures.
`explainRanking()` exposes each candidate's deterministic rank factors for debugging.
Runtime snapshot revisions are deterministic for the same event ordering; opaque execution IDs
intentionally include per-instance entropy so persistent idempotency receipts do not collide
after reload. No command execution is delegated to a framework effect.
