# @cmdflow/dom

Browser interaction for the framework-independent CmdFlow store. The controller owns keyboard and
pointer routing, composition, native or managed modal behavior, mounted ARIA references, focus,
scroll anchors, and a persistent status region. It never renders or reorders result markup.

## Framework adapters

Use the default `eventMode: "props"`. Render the flat prop getters, compose each consumer handler
first, and call the library handler only when the event was not prevented. React adapters should
forward the synthetic event's `nativeEvent`. Bind elements through the corresponding lifecycle
methods; each method returns an idempotent cleanup.

Pass the exact rendered snapshot to both getters and `controller.sync(snapshot)`. Call `sync`
after the renderer commits refs and markup. A subscription notification or microtask is not a
render commit. The controller does not subscribe automatically.

```ts
const controller = createDomController(store, {
  id: hydrationSafeInstanceId,
  eventMode: "props",
  label: "Project commands",
});

const snapshot = store.getSnapshot();
const address = { surface: "main", frameId: snapshot.current.id } as const;
const inputProps = controller.getInputProps(address, snapshot);
const itemProps = controller.getItemProps(item.candidateId, address, snapshot);
// Mount: bindInput(input, address), registerItem(item.candidateId, row, address).
// After the same snapshot commits:
controller.sync(snapshot);
```

Explicit frame addresses prevent an old component's cleanup or event from affecting a replacement
view. Prop mode installs no native input or result handlers. Native dialog lifecycle and an optional
document shortcut are separately bound by `bindDialog`. Cleanup functions release their own
listeners, making mount/cleanup/remount safe. `destroy()` releases every binding and is terminal;
the host independently owns `store.destroy()`.

## Vanilla DOM

Use `eventMode: "delegate"` and let CmdFlow attach native input and delegated result handlers.
Getters are still useful for explicit buttons and custom parts, but do not also attach the input,
result, or dialog keyboard handlers returned by the getters in this mode.

```ts
import { createCmdFlow } from "@cmdflow/core";
import { createDomController } from "@cmdflow/dom";

const store = createCmdFlow({
  commands: [{ id: "create.issue", title: "Create issue", run: createIssue }],
});
const controller = createDomController(store, { eventMode: "delegate" });
const unbindDialog = controller.bindDialog(dialog);
let boundFrameId: string | undefined;
let releaseFrameBindings = () => {};
let itemBindings: (() => void)[] = [];

function render() {
  const snapshot = store.getSnapshot();
  const address = { surface: "main", frameId: snapshot.current.id } as const;
  if (boundFrameId !== address.frameId) {
    releaseFrameBindings();
    boundFrameId = address.frameId;
    const releaseInput = controller.bindInput(input, address);
    const releaseList = controller.bindList(list, address);
    releaseFrameBindings = () => { releaseInput(); releaseList(); };
  }
  for (const dispose of itemBindings) dispose();
  itemBindings = [];
  list.replaceChildren();
  for (const item of snapshot.current.items) {
    const row = list.ownerDocument.createElement("div");
    row.textContent = item.title;
    list.append(row);
    itemBindings.push(controller.registerItem(item.candidateId, row, address));
  }
  controller.sync(snapshot);
}

const unsubscribe = store.subscribe(render);
render();
const open = () => store.open();
openButton.addEventListener("click", open);
function teardown() {
  openButton.removeEventListener("click", open);
  unsubscribe();
  for (const dispose of itemBindings) dispose();
  releaseFrameBindings();
  unbindDialog();
  controller.destroy();
  store.destroy();
}
```

Keep input/list bindings stable while the frame and elements are unchanged, including during IME
composition. Call `teardown` when this host is disposed. For production lists, also keep keyed nodes
and item registrations instead of replacing all rows. Render
`snapshot.actionFrame` as a separate searchable surface inside the outer dialog and pass
`surface: "actions"` to its bindings. Form/detail/custom views use their own markup. `bindForm`,
`bindField`, `getFieldProps`, and `getFieldErrorProps` connect native controls to form state.

## Interaction contract

- The search input keeps DOM focus. Up/Down move active identity; disabled options remain
  navigable. Enter invokes the primary action; platform modifier + Enter invokes the secondary.
  Home/End/Left/Right remain native input editing keys.
- `Cmd/Ctrl+K` opens contextual actions. Set `actionShortcut` to customize or disable it. Global
  opening is opt-in through `openShortcut`; a document registry resolves competing instances by
  `shortcutPriority` and registration order. Global shortcuts do not intercept editable controls.
- IME composition owns its keys and commits the final search value after composition ends.
- A searchable actions region is a labeled dialog containing a combobox/listbox, inside the
  outer dialog. Keep native-dialog portals inside that dialog so they are not inert.
- Options contain descriptive content only. Render independently interactive actions outside
  options. `aria-selected` describes committed selection, independently of active navigation.
- Native `<dialog>` is preferred. A bound generic element gets managed outside inertness and
  Tab containment; the host must keep its interactive content within that element.
- A status region is provided automatically. `bindStatus` replaces it with host markup while
  retaining accessibility-critical hidden styles. `bindConfirmation` connects a host-rendered
  confirmation region; the host supplies visible confirm/cancel buttons.
- All lookups use a bound element's owner document and root, including open shadow roots and
  iframe documents. ARIA references spanning different roots are omitted.

`getVirtualRange` provides optional fixed-height ranges that pin the active index. Render its
indexes in returned order and use `offsetFor(index)` for absolute positioning. Variable-height or
grouped virtualizers can use their own layout while retaining the same active-mounted invariant.

## Optional CSS

```ts
import "@cmdflow/dom/reset.css"; // Scoped low-specificity reset.
// Or import "@cmdflow/dom/preset.css"; // Includes the reset and a small system-color preset.
```

Styles target `data-cmdflow-root`, `data-cmdflow-part`, `data-state`, and `data-disabled`. Correct
keyboard, focus, and status behavior does not depend on importing either stylesheet.

## Validation status

The automated DOM suite exercises both event modes, mounted ARIA relationships, composition,
keyboard and pointer routing, modal state, focus restoration, shadow roots, and multiple instances
in Happy DOM. The standalone fixture in `e2e/dom.spec.ts` also runs nine conformance scenarios in
Chromium, Firefox, and WebKit: native modal Tab containment and focus restoration, contextual
navigation, confirmation inertness, pointer opener restoration, controlled cancellation, synthetic
composition, ShadowRoot and iframe scopes, and disposal.

Synthetic composition checks event routing; it does not replace real Japanese/Chinese/Korean IME
testing. Browser automation also cannot establish assistive-technology interoperability. The
manual screen-reader matrix in `docs/architecture.md` remains a release gate; no complete
VoiceOver/NVDA pass is claimed here.
