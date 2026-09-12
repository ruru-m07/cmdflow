import type {
  CandidateId,
  CmdFlow,
  CmdFlowSnapshot,
  FieldValue,
  FrameSnapshot,
  Keybinding,
  Surface,
  SurfaceAddress,
} from "@cmdflow/core";

type Address = Surface | SurfaceAddress;
type InputElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type Cleanup = () => void;

export interface DomControllerOptions {
  readonly id?: string;
  readonly eventMode?: "props" | "delegate";
  readonly scope?: Document | ShadowRoot;
  readonly label?: string;
  readonly searchLabel?: string;
  readonly actionsLabel?: string;
  readonly backspaceToPop?: boolean;
  readonly openShortcut?: Keybinding | false;
  readonly actionShortcut?: Keybinding | false;
  readonly shortcutPriority?: number;
  readonly restoreFocus?: () => HTMLElement | null;
  readonly announcementDelay?: number;
  readonly onDiagnostic?: (message: string) => void;
}

/** Required independently of optional reset/preset CSS. */
export const visuallyHiddenStyle = {
  position: "absolute" as const,
  width: "1px",
  height: "1px",
  padding: "0",
  margin: "-1px",
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap" as const,
  border: "0",
};

function targetOf(event: Event): EventTarget | null {
  return event.composedPath?.()[0] ?? event.target;
}

function isElement(value: unknown): value is HTMLElement {
  return typeof value === "object" && value !== null && "nodeType" in value && value.nodeType === 1;
}

function isEditable(element: unknown): boolean {
  return (
    isElement(element) &&
    (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) ||
      element.isContentEditable ||
      element.closest('[contenteditable="true"]') !== null)
  );
}

function isApple(document: Document): boolean {
  return /Mac|iPhone|iPad|iPod/u.test(document.defaultView?.navigator.platform ?? "");
}

export function matchesKeybinding(
  event: KeyboardEvent,
  binding: Keybinding,
  apple = false,
): boolean {
  const ctrl = binding.ctrl ?? (binding.mod === true && !apple);
  const meta = binding.meta ?? (binding.mod === true && apple);
  return (
    event.key.toLowerCase() === binding.key.toLowerCase() &&
    event.ctrlKey === ctrl &&
    event.metaKey === meta &&
    event.altKey === (binding.alt ?? false) &&
    event.shiftKey === (binding.shift ?? false)
  );
}

export function describeKeybinding(binding: Keybinding, apple = false): string {
  return [
    binding.ctrl || (binding.mod && !apple) ? "Control" : null,
    binding.meta || (binding.mod && apple) ? "Meta" : null,
    binding.alt ? "Alt" : null,
    binding.shift ? "Shift" : null,
    binding.key === " " ? "Space" : binding.key.toUpperCase(),
  ]
    .filter(Boolean)
    .join("+");
}

function deepActive(scope: Document | ShadowRoot): HTMLElement | null {
  let active = scope.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return isElement(active) ? active : null;
}

function composedParent(element: HTMLElement): HTMLElement | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return "host" in root && isElement(root.host) ? root.host : null;
}

function validFocus(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected || typeof element.focus !== "function") return false;
  if (element.matches(":disabled")) return false;
  let ancestor: HTMLElement | null = element;
  while (ancestor) {
    const style = ancestor.ownerDocument.defaultView?.getComputedStyle(ancestor);
    if (
      ancestor.hidden ||
      ancestor.inert ||
      style?.display === "none" ||
      style?.visibility === "hidden"
    )
      return false;
    ancestor = composedParent(ancestor);
  }
  return element.tabIndex >= 0 || element.hasAttribute("tabindex") || isEditable(element);
}

function focus(element: HTMLElement | null | undefined): boolean {
  if (!element || !validFocus(element)) return false;
  element.focus({ preventScroll: true });
  return true;
}

type GlobalShortcut = { priority: number; handle(event: KeyboardEvent): boolean };
const shortcuts = new WeakMap<
  Document,
  { entries: GlobalShortcut[]; listener: (event: KeyboardEvent) => void }
>();
let controllerSerial = 0;

function registerShortcut(document: Document, entry: GlobalShortcut): Cleanup {
  let registry = shortcuts.get(document);
  if (!registry) {
    const entries: GlobalShortcut[] = [];
    const listener = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        isEditable(targetOf(event))
      )
        return;
      for (const candidate of [...entries].sort((a, b) => b.priority - a.priority)) {
        if (candidate.handle(event)) break;
      }
    };
    registry = { entries, listener };
    shortcuts.set(document, registry);
    document.addEventListener("keydown", listener);
  }
  registry.entries.push(entry);
  return () => {
    const index = registry.entries.indexOf(entry);
    if (index !== -1) registry.entries.splice(index, 1);
    if (registry.entries.length === 0) {
      document.removeEventListener("keydown", registry.listener);
      shortcuts.delete(document);
    }
  };
}

const inertOwners = new WeakMap<HTMLElement, { count: number; previous: boolean }>();

function makeOutsideInert(dialog: HTMLElement): Cleanup {
  const changed: HTMLElement[] = [];
  let child: HTMLElement = dialog;
  for (;;) {
    const parent = child.parentNode;
    if (!parent) break;
    if ("children" in parent) {
      for (const sibling of (parent as ParentNode).children) {
        if (sibling === child || !isElement(sibling)) continue;
        const owner = inertOwners.get(sibling) ?? { count: 0, previous: sibling.inert };
        owner.count += 1;
        inertOwners.set(sibling, owner);
        sibling.inert = true;
        changed.push(sibling);
      }
    }
    if (isElement(parent)) child = parent;
    else if ("host" in parent && isElement(parent.host)) child = parent.host;
    else break;
  }
  return () => {
    for (const element of changed) {
      const owner = inertOwners.get(element);
      if (!owner) continue;
      owner.count -= 1;
      if (owner.count === 0) {
        element.inert = owner.previous;
        inertOwners.delete(element);
      }
    }
  };
}

function nativeDialog(element: HTMLElement): element is HTMLDialogElement {
  return (
    element.tagName === "DIALOG" &&
    "showModal" in element &&
    typeof element.showModal === "function"
  );
}

/** Lifecycle binding never assumes a store notification means a framework has committed. */
export function createDomController<T>(store: CmdFlow<T>, options: DomControllerOptions = {}) {
  const prefix = options.id ?? `${store.id}-${++controllerSerial}`;
  const mode = options.eventMode ?? "props";
  const actionShortcut =
    options.actionShortcut === undefined ? { key: "k", mod: true } : options.actionShortcut;
  const cleanups = new Set<Cleanup>();
  const inputs = new Map<string, HTMLInputElement>();
  const lists = new Map<string, HTMLElement>();
  const forms = new Map<string, HTMLFormElement>();
  const fields = new Map<string, InputElement>();
  const items = new Map<string, HTMLElement>();
  const openers = new Map<string, HTMLElement | null>();
  const composing = new Set<string>();
  let dialog: HTMLElement | null = null;
  let status: HTMLElement | null = null;
  let internalStatus: HTMLElement | null = null;
  let confirmation: HTMLElement | null = null;
  let shellOpener: HTMLElement | null = null;
  let requestedActionOpener: HTMLElement | null = null;
  let committed: CmdFlowSnapshot | null = null;
  let restoreInert: Cleanup | undefined;
  let restoreConfirmationInert: Cleanup | undefined;
  let destroyed = false;
  let modality: "keyboard" | "pointer" = "keyboard";
  let pointer: { x: number; y: number } | null = null;
  let announcementTimer: ReturnType<typeof setTimeout> | undefined;
  let announcementKey = "";
  let nativeClosing = false;

  function warn(message: string) {
    options.onDiagnostic?.(message);
  }
  function scope(): Document | ShadowRoot | undefined {
    const root = dialog?.getRootNode();
    return (
      options.scope ??
      (root && (root.nodeType === 9 || "host" in root)
        ? (root as Document | ShadowRoot)
        : dialog?.ownerDocument)
    );
  }
  function address(value: Address = "main", snapshot = store.getSnapshot()): SurfaceAddress {
    if (typeof value !== "string") return value;
    const frame = value === "actions" ? snapshot.actionFrame : snapshot.current;
    return { surface: value, frameId: frame?.id ?? "absent" };
  }
  function frameFor(
    value: Address = "main",
    snapshot = store.getSnapshot(),
  ): FrameSnapshot | undefined {
    const addr = address(value, snapshot);
    return snapshot[addr.surface].find((frame) => frame.id === addr.frameId);
  }
  function key(value: Address = "main", snapshot = store.getSnapshot()) {
    const addr = address(value, snapshot);
    return `${addr.surface}:${addr.frameId}`;
  }
  function partId(
    part: string,
    value: Address = "main",
    suffix = "",
    snapshot = store.getSnapshot(),
  ) {
    const addr = address(value, snapshot);
    return `${prefix}-${part}-${encodeURIComponent(addr.surface)}-${encodeURIComponent(addr.frameId)}-${encodeURIComponent(suffix)}`;
  }
  function itemKey(id: CandidateId, value: Address = "main", snapshot = store.getSnapshot()) {
    return `${key(value, snapshot)}:${id}`;
  }
  function cleanup(fn: Cleanup): Cleanup {
    let active = true;
    const dispose = () => {
      if (active) {
        active = false;
        cleanups.delete(dispose);
        fn();
      }
    };
    cleanups.add(dispose);
    return dispose;
  }
  function listen(element: EventTarget, name: string, handler: (event: Event) => void): Cleanup {
    element.addEventListener(name, handler);
    return () => element.removeEventListener(name, handler);
  }
  function attributes(element: HTMLElement, props: object) {
    for (const [name, value] of Object.entries(props)) {
      if (name.startsWith("on") || name === "style" || name === "value" || name === "checked")
        continue;
      if (
        mode === "props" &&
        (name === "aria-label" || name === "aria-labelledby" || name === "aria-describedby") &&
        element.hasAttribute(name)
      )
        continue;
      const attribute = name === "tabIndex" ? "tabindex" : name;
      if (value === undefined || value === null) element.removeAttribute(attribute);
      else if (name === "hidden" || name === "required" || name === "disabled")
        element.toggleAttribute(name, value === true);
      else element.setAttribute(attribute, String(value));
    }
  }
  function activeAddress(snapshot = store.getSnapshot()): SurfaceAddress {
    return address(snapshot.actionFrame ? "actions" : "main", snapshot);
  }
  function eventAddress(event: Event): SurfaceAddress {
    const snapshot = store.getSnapshot();
    const target = targetOf(event);
    for (const frame of [...snapshot.main, ...snapshot.actions]) {
      const addr = { surface: frame.surface, frameId: frame.id };
      if (inputs.get(key(addr)) === target) return addr;
    }
    return activeAddress(snapshot);
  }
  function handleKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented || destroyed) return;
    const snapshot = store.getSnapshot();
    if (
      !snapshot.open ||
      event.isComposing ||
      event.keyCode === 229 ||
      composing.size > 0 ||
      snapshot.current.composing ||
      snapshot.actionFrame?.composing
    )
      return;
    const addr = eventAddress(event);
    const frame = frameFor(addr);
    const target = targetOf(event);
    const search = inputs.get(key(addr)) === target;
    const apple = dialog ? isApple(dialog.ownerDocument) : false;
    const bare = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if (event.key === "Escape" && bare) {
      event.preventDefault();
      if (!event.repeat) store.escape();
      return;
    }
    if (snapshot.confirmation) {
      if (event.key === "Tab" && confirmation) {
        const controls = [
          ...confirmation.querySelectorAll<HTMLElement>(
            "input,textarea,select,button,a[href],[tabindex]",
          ),
        ].filter((element) => validFocus(element) && element.tabIndex >= 0);
        const first = controls[0];
        const last = controls.at(-1);
        const current = scope()?.activeElement;
        if (!first) {
          event.preventDefault();
          focus(confirmation);
        } else if (event.shiftKey && (current === first || current === confirmation)) {
          event.preventDefault();
          focus(last);
        } else if (!event.shiftKey && (current === last || current === confirmation)) {
          event.preventDefault();
          focus(first);
        }
      }
      return;
    }
    if (event.key === "Tab" && dialog) {
      const controls = [
        ...dialog.querySelectorAll<HTMLElement>("input,textarea,select,button,a[href],[tabindex]"),
      ].filter((element) => validFocus(element) && element.tabIndex >= 0);
      const first = controls[0];
      const last = controls.at(-1);
      const current = scope()?.activeElement;
      if (!first) {
        event.preventDefault();
        focus(dialog);
      } else if (event.shiftKey && (current === first || current === dialog)) {
        event.preventDefault();
        focus(last);
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        focus(first);
      }
      return;
    }
    if (actionShortcut && matchesKeybinding(event, actionShortcut, apple)) {
      event.preventDefault();
      if (!event.repeat && frame) {
        if (snapshot.actionFrame) store.closeActions();
        else store.openActions(undefined, addr);
      }
      return;
    }
    if (search && bare && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      modality = "keyboard";
      event.preventDefault();
      store.moveActive(event.key === "ArrowDown" ? "next" : "previous", addr);
      return;
    }
    if (
      search &&
      bare &&
      event.key === "Backspace" &&
      frame?.query === "" &&
      options.backspaceToPop
    ) {
      if (snapshot[addr.surface].length > 1) {
        event.preventDefault();
        if (!event.repeat) store.pop(addr.surface);
      }
      return;
    }
    if (search && event.key === "Enter" && !event.altKey && !event.shiftKey) {
      const secondary = matchesKeybinding(event, { key: "Enter", mod: true }, apple);
      if (!secondary && (event.metaKey || event.ctrlKey)) return;
      const active = frame?.items.find((item) => item.candidateId === frame.activeId);
      const action = secondary
        ? (active?.actions ?? frame?.actions)?.find(
            (candidate) => candidate.priority === "secondary",
          )
        : undefined;
      if (secondary && !action) return;
      event.preventDefault();
      if (!event.repeat)
        void store.invoke({ address: addr, ...(action ? { actionId: action.id } : {}) });
      return;
    }
    if (frame) {
      const active = frame.items.find((item) => item.candidateId === frame.activeId);
      const action = [...(active?.actions ?? []), ...frame.actions].find(
        (candidate) => candidate.shortcut && matchesKeybinding(event, candidate.shortcut, apple),
      );
      if (
        action &&
        (!isEditable(target) ||
          action.shortcut?.mod ||
          action.shortcut?.ctrl ||
          action.shortcut?.meta ||
          action.shortcut?.alt)
      ) {
        event.preventDefault();
        if (!event.repeat) void store.invoke({ address: addr, actionId: action.id });
      }
    }
  }
  function inputHandler(event: Event, value: Address) {
    if (event.defaultPrevented) return;
    const target = targetOf(event);
    if ("isComposing" in event && event.isComposing === true) composing.add(key(value));
    if (isElement(target) && "value" in target)
      store.setQuery(String(target.value), address(value), composing.has(key(value)));
  }
  function compositionStart(event: Event, value: Address) {
    if (event.defaultPrevented) return;
    composing.add(key(value));
  }
  function compositionEnd(event: Event, value: Address) {
    composing.delete(key(value));
    inputHandler(event, value);
  }
  function clickItem(event: Event, id: CandidateId, value: Address) {
    if (event.defaultPrevented || composing.size || frameFor(value)?.composing) return;
    store.setActive(id, address(value));
    void store.invoke({ address: address(value), candidateId: id });
  }
  function pointerItem(event: PointerEvent, id: CandidateId, value: Address) {
    if (event.defaultPrevented || event.pointerType === "touch") return;
    const moved = pointer === null || pointer.x !== event.clientX || pointer.y !== event.clientY;
    pointer = { x: event.clientX, y: event.clientY };
    if (!moved) return;
    modality = "pointer";
    store.setActive(id, address(value));
  }
  function getDialogProps(snapshot = store.getSnapshot()) {
    return {
      "data-cmdflow-root": "",
      "data-state": snapshot.open ? "open" : "closed",
      "aria-label": options.label ?? "Command palette",
      role: "dialog" as const,
      "aria-modal": snapshot.open ? true : undefined,
      tabIndex: -1,
      onKeyDown: handleKeyDown,
    };
  }
  function getInputProps(value: Address = "main", snapshot = store.getSnapshot()) {
    const frame = frameFor(value, snapshot);
    const addr = address(value, snapshot);
    const mounted = frame?.activeId
      ? items.get(itemKey(frame.activeId, addr, snapshot))
      : undefined;
    const input = inputs.get(key(addr));
    const list = lists.get(key(addr));
    const referenceValid =
      mounted?.isConnected &&
      list?.isConnected &&
      list.contains(mounted) &&
      (!input || input.getRootNode() === mounted.getRootNode()) &&
      (!dialog || !nativeDialog(dialog) || dialog.contains(mounted));
    const activeId = referenceValid
      ? partId("item", addr, frame?.activeId ?? "", snapshot)
      : undefined;
    return {
      id: partId("input", addr, "", snapshot),
      "data-cmdflow-part": "input",
      "data-cmdflow-surface": addr.surface,
      "data-cmdflow-frame": addr.frameId,
      role: "combobox" as const,
      type: "text" as const,
      autoComplete: "off",
      autoCorrect: "off",
      spellCheck: false,
      "aria-label":
        addr.surface === "actions"
          ? (options.actionsLabel ?? "Search actions")
          : (options.searchLabel ?? "Search commands"),
      "aria-autocomplete": "list" as const,
      "aria-expanded": snapshot.open && frame !== undefined,
      "aria-controls": partId("list", addr, "", snapshot),
      "aria-activedescendant": activeId,
      value: frame?.query ?? "",
      onInput: (event: Event) => inputHandler(event, addr),
      onCompositionStart: (event: Event) => compositionStart(event, addr),
      onCompositionEnd: (event: Event) => compositionEnd(event, addr),
      onKeyDown: handleKeyDown,
    };
  }
  function getListProps(value: Address = "main", snapshot = store.getSnapshot()) {
    const frame = frameFor(value, snapshot);
    return {
      id: partId("list", value, "", snapshot),
      "data-cmdflow-part": "list",
      role: "listbox" as const,
      "aria-label":
        frame?.view.title ||
        (address(value, snapshot).surface === "actions" ? "Actions" : "Results"),
      "aria-busy": frame?.sources.some((source) => source.status === "loading") ?? false,
      "data-loading": String(frame?.sources.some((source) => source.status === "loading") ?? false),
      "aria-multiselectable": frame?.view.selectionMode === "multiple" ? true : undefined,
    };
  }
  function getItemProps(id: CandidateId, value: Address = "main", snapshot = store.getSnapshot()) {
    const frame = frameFor(value, snapshot);
    const index = frame?.items.findIndex((item) => item.candidateId === id) ?? -1;
    const item = index >= 0 ? frame?.items[index] : undefined;
    const addr = address(value, snapshot);
    return {
      id: partId("item", addr, id, snapshot),
      role: "option" as const,
      "data-cmdflow-part": "item",
      "data-cmdflow-id": id,
      "data-cmdflow-surface": addr.surface,
      "data-cmdflow-frame": addr.frameId,
      "data-state": frame?.activeId === id ? "active" : "inactive",
      "data-disabled": String(item?.disabled ?? false),
      "aria-disabled": item?.disabled ? true : undefined,
      "aria-description": item?.disabledReason,
      "aria-selected":
        frame?.view.selectionMode !== "none" ? frame?.selectedIds.includes(id) : undefined,
      "aria-posinset": index >= 0 ? index + 1 : undefined,
      "aria-setsize": frame?.sources.some(
        (source) => source.status === "loading" || source.nextCursor !== undefined,
      )
        ? -1
        : frame?.items.length,
      onClick: (event: Event) => clickItem(event, id, addr),
      onPointerMove: (event: PointerEvent) => pointerItem(event, id, addr),
      onPointerDown: (event: PointerEvent) => {
        if (!event.defaultPrevented && event.pointerType !== "touch") event.preventDefault();
      },
    };
  }
  function getGroupProps(label: string, value: Address = "main", snapshot = store.getSnapshot()) {
    return {
      id: partId("group", value, label, snapshot),
      "data-cmdflow-part": "group",
      role: "group" as const,
      "aria-label": label,
    };
  }
  function getActionsTriggerProps(snapshot = store.getSnapshot()) {
    const shortcut = actionShortcut
      ? describeKeybinding(actionShortcut, dialog ? isApple(dialog.ownerDocument) : false)
      : undefined;
    return {
      type: "button" as const,
      "data-cmdflow-part": "actions-trigger",
      "aria-label": "Actions",
      "aria-haspopup": "dialog" as const,
      "aria-expanded": snapshot.actionFrame !== null,
      "aria-keyshortcuts": shortcut,
      onClick: (event: Event) => {
        if (!event.defaultPrevented) {
          if (store.getSnapshot().actionFrame) store.closeActions();
          else {
            requestedActionOpener =
              event
                .composedPath()
                .find(
                  (target): target is HTMLElement =>
                    isElement(target) &&
                    target.getAttribute("data-cmdflow-part") === "actions-trigger",
                ) ?? null;
            store.openActions(undefined, address("main"));
            if (!store.getSnapshot().actionFrame) requestedActionOpener = null;
          }
        }
      },
    };
  }
  function getCloseProps(_snapshot = store.getSnapshot()) {
    return {
      type: "button" as const,
      "data-cmdflow-part": "close",
      "aria-label": "Close command palette",
      onClick: (event: Event) => {
        if (!event.defaultPrevented) store.close();
      },
    };
  }
  function getBackProps(value: Address = "main", snapshot = store.getSnapshot()) {
    const addr = address(value, snapshot);
    return {
      type: "button" as const,
      "data-cmdflow-part": "back",
      "aria-label": "Go back",
      onClick: (event: Event) => {
        if (!event.defaultPrevented) store.pop(addr.surface);
      },
    };
  }
  function getFormProps(value: Address = "main", snapshot = store.getSnapshot()) {
    const frame = frameFor(value, snapshot);
    const addr = address(value, snapshot);
    return {
      "data-cmdflow-part": "form",
      "aria-label": frame?.view.title || "Command form",
      "aria-busy": frame?.form.submitting ?? false,
      onSubmit: (event: Event) => {
        if (!event.defaultPrevented) {
          event.preventDefault();
          void store.submitForm(addr);
        }
      },
    };
  }
  function getFieldProps(fieldId: string, value: Address = "main", snapshot = store.getSnapshot()) {
    const frame = frameFor(value, snapshot);
    const field = frame?.view.fields.find((candidate) => candidate.id === fieldId);
    const addr = address(value, snapshot);
    const error = frame?.form.errors[fieldId];
    return {
      id: partId("field", addr, fieldId, snapshot),
      name: fieldId,
      "data-cmdflow-part": "field",
      type:
        field?.type === "textarea" || field?.type === "select"
          ? undefined
          : (field?.type ?? "text"),
      "aria-label": field?.label ?? fieldId,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? partId("field-error", addr, fieldId, snapshot) : undefined,
      required: field?.required,
      value: field?.type === "checkbox" ? undefined : (frame?.form.values[fieldId] ?? ""),
      checked: field?.type === "checkbox" ? Boolean(frame?.form.values[fieldId]) : undefined,
      onInput: (event: Event) => {
        if (event.defaultPrevented) return;
        const target = targetOf(event) as InputElement | null;
        if (!target || !("value" in target)) return;
        let next: FieldValue = target.value;
        if (target.tagName === "INPUT" && (target as HTMLInputElement).type === "checkbox")
          next = (target as HTMLInputElement).checked;
        else if (target.tagName === "SELECT" && (target as HTMLSelectElement).multiple)
          next = [...(target as HTMLSelectElement).selectedOptions].map((option) => option.value);
        store.setField(fieldId, next, addr);
      },
    };
  }
  function getFieldErrorProps(
    fieldId: string,
    value: Address = "main",
    snapshot = store.getSnapshot(),
  ) {
    return {
      id: partId("field-error", value, fieldId, snapshot),
      "data-cmdflow-part": "field-error",
    };
  }
  function getStatusProps(_snapshot = store.getSnapshot()) {
    return {
      "data-cmdflow-part": "status",
      role: "status" as const,
      "aria-live": "polite" as const,
      "aria-atomic": true,
      style: visuallyHiddenStyle,
    };
  }
  function getConfirmationProps(snapshot = store.getSnapshot()) {
    return {
      "data-cmdflow-part": "confirmation",
      role: "alertdialog" as const,
      "aria-label": snapshot.confirmation?.title ?? "Confirm action",
      "aria-modal": snapshot.confirmation ? true : undefined,
      tabIndex: -1,
    };
  }

  function announce(message: string, delay = 0) {
    if (announcementTimer !== undefined) clearTimeout(announcementTimer);
    if (delay === 0) {
      if (status) status.textContent = message;
      return;
    }
    announcementTimer = setTimeout(() => {
      if (!destroyed && status) status.textContent = message;
    }, delay);
  }
  function initialFocus(frame: FrameSnapshot) {
    const addr = { surface: frame.surface, frameId: frame.id };
    if (frame.view.type === "form") {
      const invalid = Object.keys(frame.form.errors)[0];
      const first = frame.view.fields[0]?.id;
      if (invalid && focus(fields.get(`${key(addr)}:${invalid}`))) return;
      if (first && focus(fields.get(`${key(addr)}:${first}`))) return;
      if (focus(forms.get(key(addr)))) return;
    }
    if (!focus(inputs.get(key(addr)))) focus(dialog);
  }
  function scrollActive(frame: FrameSnapshot) {
    if (modality === "pointer") return;
    const addr = { surface: frame.surface, frameId: frame.id };
    const viewport = lists.get(key(addr));
    const active = frame.activeId ? items.get(itemKey(frame.activeId, addr)) : undefined;
    if (!viewport || !active?.isConnected) return;
    const box = viewport.getBoundingClientRect();
    const row = active.getBoundingClientRect();
    if (row.top < box.top) viewport.scrollTop += row.top - box.top;
    else if (row.bottom > box.bottom) viewport.scrollTop += row.bottom - box.bottom;
  }
  function restoreScroll(frame: FrameSnapshot): boolean {
    if (!frame.scrollAnchor) return false;
    const addr = { surface: frame.surface, frameId: frame.id };
    const viewport = lists.get(key(addr));
    const anchor = items.get(itemKey(frame.scrollAnchor.candidateId, addr));
    if (!viewport || !anchor?.isConnected) return false;
    viewport.scrollTop +=
      anchor.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top -
      frame.scrollAnchor.offset;
    return true;
  }
  function sync(snapshot = store.getSnapshot()) {
    if (destroyed || !dialog || (committed && snapshot.revision < committed.revision)) return;
    const previous = committed;
    const root = scope();
    const opened = snapshot.open && !previous?.open;
    const closed = !snapshot.open && previous?.open;
    const oldActive = previous?.actionFrame ?? previous?.current;
    const newActive = snapshot.actionFrame ?? snapshot.current;
    let restoredFrameFocus = false;
    if (opened) shellOpener = root ? deepActive(root) : null;
    if (snapshot.open && newActive.id !== oldActive?.id && !openers.has(newActive.id)) {
      openers.set(
        newActive.id,
        newActive.surface === "actions"
          ? (requestedActionOpener ?? (root ? deepActive(root) : null))
          : root
            ? deepActive(root)
            : null,
      );
      requestedActionOpener = null;
    }
    if (mode === "delegate") attributes(dialog, getDialogProps(snapshot));
    if (confirmation && mode === "delegate")
      attributes(confirmation, getConfirmationProps(snapshot));
    if (nativeDialog(dialog)) {
      if (snapshot.open && !dialog.open && dialog.isConnected) dialog.showModal();
      else if (!snapshot.open && dialog.open) {
        nativeClosing = true;
        dialog.close();
        nativeClosing = false;
      }
    } else {
      dialog.hidden = !snapshot.open;
      if (snapshot.open && !restoreInert) restoreInert = makeOutsideInert(dialog);
      if (!snapshot.open && restoreInert) {
        restoreInert();
        restoreInert = undefined;
      }
    }
    for (const frame of [...snapshot.main, ...snapshot.actions]) {
      const addr = { surface: frame.surface, frameId: frame.id };
      const input = inputs.get(key(addr));
      if (input) {
        const props = getInputProps(addr, snapshot);
        if (mode === "delegate") {
          attributes(input, props);
          if (input.value !== frame.query && !composing.has(key(addr))) input.value = frame.query;
        } else if (props["aria-activedescendant"]) {
          input.setAttribute("aria-activedescendant", props["aria-activedescendant"]);
        } else input.removeAttribute("aria-activedescendant");
      }
      const list = lists.get(key(addr));
      if (list && mode === "delegate") attributes(list, getListProps(addr, snapshot));
      if (mode === "delegate") {
        const form = forms.get(key(addr));
        if (form) attributes(form, getFormProps(addr, snapshot));
        for (const field of frame.view.fields) {
          const element = fields.get(`${key(addr)}:${field.id}`);
          if (!element) continue;
          const props = getFieldProps(field.id, addr, snapshot);
          attributes(element, props);
          if (field.type === "checkbox")
            (element as HTMLInputElement).checked = Boolean(props.checked);
          else if (!Array.isArray(props.value) && element.value !== String(props.value ?? ""))
            element.value = String(props.value ?? "");
        }
      }
      for (const item of frame.items) {
        const element = items.get(itemKey(item.candidateId, addr));
        if (element && mode === "delegate")
          attributes(element, getItemProps(item.candidateId, addr, snapshot));
      }
    }
    if (opened) initialFocus(newActive);
    else if (snapshot.open && oldActive && oldActive.id !== newActive.id) {
      const popping = [...(previous?.main ?? []), ...(previous?.actions ?? [])].some(
        (frame) => frame.id === newActive.id,
      );
      restoredFrameFocus = popping && focus(openers.get(oldActive.id));
      if (!restoredFrameFocus) initialFocus(newActive);
    }
    if (!snapshot.confirmation && restoreConfirmationInert) {
      restoreConfirmationInert();
      restoreConfirmationInert = undefined;
    }
    if (snapshot.confirmation && snapshot.confirmation.id !== previous?.confirmation?.id) {
      openers.set(`confirmation:${snapshot.confirmation.id}`, root ? deepActive(root) : null);
      if (confirmation && !restoreConfirmationInert)
        restoreConfirmationInert = makeOutsideInert(confirmation);
      focus(confirmation);
    } else if (!snapshot.confirmation && previous?.confirmation) {
      if (!focus(openers.get(`confirmation:${previous.confirmation.id}`))) initialFocus(newActive);
    }
    if (closed) {
      if (!focus(shellOpener)) focus(options.restoreFocus?.());
      openers.clear();
      composing.clear();
      if (status) status.textContent = "";
    }
    if (snapshot.open) {
      const changedActive = newActive.activeId !== oldActive?.activeId;
      if (changedActive || !restoreScroll(newActive)) {
        if (changedActive || newActive.id !== oldActive?.id) scrollActive(newActive);
      }
    }
    committed = snapshot;
    const effects = store.getDomEffects().filter((effect) => effect.revision <= snapshot.revision);
    const acknowledged: number[] = [];
    for (const effect of effects) {
      const frame = [...snapshot.main, ...snapshot.actions].find(
        (candidate) => candidate.id === effect.frameId,
      );
      if (effect.type === "announce") {
        if (snapshot.open && effect.message) announce(effect.message);
        acknowledged.push(effect.id);
      } else if (effect.type === "restore") acknowledged.push(effect.id);
      else if (!snapshot.open || (effect.frameId && frame?.id !== newActive.id))
        acknowledged.push(effect.id);
      else if (effect.type === "focus") {
        const later = effects.some(
          (candidate) => candidate.type === "focus" && candidate.id > effect.id,
        );
        if (later) {
          acknowledged.push(effect.id);
          continue;
        }
        if (restoredFrameFocus && effect.target === "input" && !effect.fieldId) {
          acknowledged.push(effect.id);
          continue;
        }
        const target =
          effect.target === "confirmation"
            ? confirmation
            : effect.fieldId
              ? fields.get(`${key(activeAddress(snapshot))}:${effect.fieldId}`)
              : effect.target === "form"
                ? (fields.get(`${key(activeAddress(snapshot))}:${newActive.view.fields[0]?.id}`) ??
                  forms.get(key(activeAddress(snapshot))))
                : (inputs.get(key(activeAddress(snapshot))) ??
                  (newActive.view.type !== "list" ? dialog : undefined));
        if (focus(target)) acknowledged.push(effect.id);
      } else if (effect.type === "scroll") {
        const targetFrame = frame ?? newActive;
        if (targetFrame.activeId !== oldActive?.activeId || !restoreScroll(targetFrame))
          scrollActive(targetFrame);
        acknowledged.push(effect.id);
      }
      if (snapshot.confirmation && effect.target !== "confirmation") {
        acknowledged.push(effect.id);
      }
    }
    if (acknowledged.length) store.acknowledgeDomEffects(acknowledged);
    const failed = newActive.sources.filter((source) => source.status === "error").length;
    const loading = newActive.sources.some((source) => source.status === "loading");
    const nextKey = `${newActive.id}:${newActive.query}:${newActive.items.length}:${failed}:${loading}`;
    if (snapshot.open && !newActive.composing && nextKey !== announcementKey) {
      announcementKey = nextKey;
      if (!loading)
        announce(
          `${newActive.items.length} ${newActive.items.length === 1 ? "result" : "results"}.${failed ? ` ${failed} search ${failed === 1 ? "source failed" : "sources failed"}.` : ""}`,
          options.announcementDelay ?? 120,
        );
    }
    const liveFrames = new Set([...snapshot.main, ...snapshot.actions].map((frame) => frame.id));
    for (const frameId of openers.keys())
      if (!frameId.startsWith("confirmation:") && !liveFrames.has(frameId)) openers.delete(frameId);
  }

  function bindDialog(element: HTMLElement): Cleanup {
    if (destroyed) throw new Error("Cannot bind a destroyed CmdFlow DOM controller");
    if (dialog && dialog !== element)
      throw new Error("A CmdFlow controller can bind only one dialog");
    dialog = element;
    const removals: Cleanup[] = [];
    if (!status) {
      internalStatus = element.ownerDocument.createElement("span");
      status = internalStatus;
      attributes(status, getStatusProps());
      Object.assign(status.style, visuallyHiddenStyle);
      element.append(status);
    }
    removals.push(
      listen(element, "cancel", (event) => {
        event.preventDefault();
        if (
          composing.size === 0 &&
          !store.getSnapshot().current.composing &&
          !store.getSnapshot().actionFrame?.composing
        )
          store.escape();
      }),
    );
    removals.push(
      listen(element, "close", () => {
        if (!nativeClosing && store.getSnapshot().open) {
          store.close();
          if (store.getSnapshot().open) sync(store.getSnapshot());
        }
      }),
    );
    if (mode === "delegate") {
      removals.push(listen(element, "keydown", (event) => handleKeyDown(event as KeyboardEvent)));
      for (const eventName of ["click", "pointermove", "pointerdown"]) {
        removals.push(
          listen(element, eventName, (event) => {
            for (const target of event.composedPath()) {
              if (!isElement(target)) continue;
              const id = target.getAttribute("data-cmdflow-id") as CandidateId | null;
              const frameId = target.getAttribute("data-cmdflow-frame");
              const surface = target.getAttribute("data-cmdflow-surface") as Surface | null;
              if (!id || !frameId || (surface !== "main" && surface !== "actions")) continue;
              const addr = { surface, frameId };
              if (items.get(itemKey(id, addr)) !== target) continue;
              if (eventName === "click") clickItem(event, id, addr);
              else if (eventName === "pointermove") pointerItem(event as PointerEvent, id, addr);
              else if (!event.defaultPrevented && (event as PointerEvent).pointerType !== "touch")
                event.preventDefault();
              break;
            }
          }),
        );
      }
    }
    if (options.openShortcut) {
      const binding = options.openShortcut;
      removals.push(
        registerShortcut(element.ownerDocument, {
          priority: options.shortcutPriority ?? 0,
          handle(event) {
            if (
              !matchesKeybinding(event, binding, isApple(element.ownerDocument)) ||
              store.getSnapshot().open
            )
              return false;
            event.preventDefault();
            store.open();
            return true;
          },
        }),
      );
    }
    if (
      !element.getAttribute("aria-label") &&
      !element.getAttribute("aria-labelledby") &&
      !options.label
    )
      warn("Dialog has no host-provided accessible name; using Command palette.");
    return cleanup(() => {
      for (const remove of removals) remove();
      restoreInert?.();
      restoreInert = undefined;
      restoreConfirmationInert?.();
      restoreConfirmationInert = undefined;
      if (internalStatus) {
        internalStatus.remove();
        if (status === internalStatus) status = null;
        internalStatus = null;
      }
      if (announcementTimer !== undefined) clearTimeout(announcementTimer);
      if (nativeDialog(element) && element.open) {
        nativeClosing = true;
        element.close();
        nativeClosing = false;
      }
      if (dialog === element) dialog = null;
      if (committed?.open && !focus(shellOpener)) focus(options.restoreFocus?.());
      committed = null;
    });
  }
  function bindInput(element: HTMLInputElement, value: Address = "main"): Cleanup {
    const addr = address(value);
    const mapKey = key(addr);
    inputs.set(mapKey, element);
    const handlers =
      mode === "delegate"
        ? [
            listen(element, "input", (event) => inputHandler(event, addr)),
            listen(element, "compositionstart", (event) => compositionStart(event, addr)),
            listen(element, "compositionend", (event) => compositionEnd(event, addr)),
          ]
        : [];
    return cleanup(() => {
      for (const remove of handlers) remove();
      if (inputs.get(mapKey) === element) inputs.delete(mapKey);
      composing.delete(mapKey);
    });
  }
  function bindList(element: HTMLElement, value: Address = "main"): Cleanup {
    const addr = address(value);
    const mapKey = key(addr);
    lists.set(mapKey, element);
    const unlisten = listen(element, "scroll", () => {
      const frame = frameFor(addr);
      const active = frame?.activeId;
      const option = active ? items.get(itemKey(active, addr)) : undefined;
      if (active && option)
        store.setScrollAnchor(
          {
            candidateId: active,
            offset: option.getBoundingClientRect().top - element.getBoundingClientRect().top,
          },
          addr,
        );
    });
    return cleanup(() => {
      unlisten();
      if (lists.get(mapKey) === element) lists.delete(mapKey);
    });
  }
  function registerItem(id: CandidateId, element: HTMLElement, value: Address = "main"): Cleanup {
    const addr = address(value);
    const mapKey = itemKey(id, addr);
    items.set(mapKey, element);
    return cleanup(() => {
      if (items.get(mapKey) === element) items.delete(mapKey);
      const input = inputs.get(key(addr));
      if (input?.getAttribute("aria-activedescendant") === element.id)
        input.removeAttribute("aria-activedescendant");
    });
  }
  function bindForm(element: HTMLFormElement, value: Address = "main"): Cleanup {
    const addr = address(value);
    const mapKey = key(addr);
    forms.set(mapKey, element);
    const remove =
      mode === "delegate" ? listen(element, "submit", getFormProps(addr).onSubmit) : () => {};
    return cleanup(() => {
      remove();
      if (forms.get(mapKey) === element) forms.delete(mapKey);
    });
  }
  function bindField(fieldId: string, element: InputElement, value: Address = "main"): Cleanup {
    const addr = address(value);
    const mapKey = `${key(addr)}:${fieldId}`;
    fields.set(mapKey, element);
    const remove =
      mode === "delegate"
        ? listen(element, "input", getFieldProps(fieldId, addr).onInput)
        : () => {};
    return cleanup(() => {
      remove();
      if (fields.get(mapKey) === element) fields.delete(mapKey);
    });
  }
  function bindStatus(element: HTMLElement): Cleanup {
    if (internalStatus) {
      internalStatus.remove();
      internalStatus = null;
    }
    status = element;
    attributes(element, getStatusProps());
    Object.assign(element.style, visuallyHiddenStyle);
    return cleanup(() => {
      if (status === element) status = null;
    });
  }
  function bindConfirmation(element: HTMLElement): Cleanup {
    confirmation = element;
    return cleanup(() => {
      if (confirmation === element) {
        confirmation = null;
        restoreConfirmationInert?.();
        restoreConfirmationInert = undefined;
      }
    });
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const dispose of [...cleanups]) dispose();
    inputs.clear();
    lists.clear();
    forms.clear();
    fields.clear();
    items.clear();
    requestedActionOpener = null;
    composing.clear();
    openers.clear();
  }
  return {
    getDialogProps,
    getInputProps,
    getListProps,
    getItemProps,
    getGroupProps,
    getActionsTriggerProps,
    getCloseProps,
    getBackProps,
    getFormProps,
    getFieldProps,
    getFieldErrorProps,
    getStatusProps,
    getConfirmationProps,
    bindDialog,
    bindInput,
    bindList,
    registerItem,
    bindForm,
    bindField,
    bindStatus,
    bindConfirmation,
    sync,
    destroy,
  };
}

export type CmdFlowDomController = ReturnType<typeof createDomController>;
