import type { CmdFlow, CmdFlowKeybinding, CmdFlowSurfaceAddress } from "@cmdflow/core";
import type { DomEffects } from "./effects.js";
import type { ElementRegistry } from "./element-registry.js";
import { eventTarget, isEditableElement, isHtmlElement, trapTabFocus } from "./focus.js";
import type { DomIds } from "./ids.js";
import { type ListDirection, pageTarget, sectionTarget } from "./list-navigation.js";
import type { Address, Cleanup, DomControllerOptions } from "./types.js";

export function isApplePlatform(document: Document): boolean {
  return /Mac|iPhone|iPad|iPod/u.test(document.defaultView?.navigator.platform ?? "");
}

export function matchesKeybinding(
  event: KeyboardEvent,
  binding: CmdFlowKeybinding,
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

export function describeKeybinding(binding: CmdFlowKeybinding, apple = false): string {
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

function listNavigation(
  event: KeyboardEvent,
  apple: boolean,
): { kind: "item" | "page" | "section"; direction: ListDirection } | undefined {
  if (apple && matchesKeybinding(event, { key: "n", ctrl: true }))
    return { kind: "item", direction: 1 };
  if (apple && matchesKeybinding(event, { key: "p", ctrl: true }))
    return { kind: "item", direction: -1 };

  const key = event.key;
  if (key !== "ArrowDown" && key !== "ArrowUp") return;
  const direction = key === "ArrowDown" ? 1 : -1;
  if (matchesKeybinding(event, { key })) return { kind: "item", direction };
  if (matchesKeybinding(event, { key, alt: true })) return { kind: "page", direction };
  if (matchesKeybinding(event, { key, mod: true }, apple)) return { kind: "section", direction };
}

interface GlobalShortcut {
  readonly priority: number;
  handle(event: KeyboardEvent): boolean;
}

const shortcuts = new WeakMap<
  Document,
  { entries: GlobalShortcut[]; listener: (event: KeyboardEvent) => void }
>();

export function registerGlobalShortcut(document: Document, entry: GlobalShortcut): Cleanup {
  let registry = shortcuts.get(document);
  if (!registry) {
    const entries: GlobalShortcut[] = [];
    const listener = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        isEditableElement(eventTarget(event))
      )
        return;
      for (const candidate of [...entries].sort((left, right) => right.priority - left.priority)) {
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

export interface KeyboardController {
  readonly composing: Set<string>;
  handleKeyDown(event: KeyboardEvent): void;
  handleInput(event: Event, address: Address): void;
  handleCompositionStart(event: Event, address: Address): void;
  handleCompositionEnd(event: Event, address: Address): void;
  clear(): void;
}

interface KeyboardControllerDependencies<TContext, TData> {
  readonly flow: CmdFlow<TContext, TData>;
  readonly options: DomControllerOptions;
  readonly actionShortcut: CmdFlowKeybinding | false;
  readonly ids: DomIds;
  readonly elements: ElementRegistry;
  readonly effects: DomEffects;
  readonly scope: () => Document | ShadowRoot | undefined;
  readonly isDestroyed: () => boolean;
}

export function createKeyboardController<TContext, TData>({
  flow,
  options,
  actionShortcut,
  ids,
  elements,
  effects,
  scope,
  isDestroyed,
}: KeyboardControllerDependencies<TContext, TData>): KeyboardController {
  const composing = new Set<string>();

  function eventAddress(event: Event): CmdFlowSurfaceAddress {
    const snapshot = flow.getSnapshot();
    const target = eventTarget(event);
    for (const frame of [...snapshot.mainFrames, ...snapshot.actionFrames]) {
      const address = { surface: frame.surface, frameId: frame.id };
      if (elements.inputs.get(ids.addressKey(address)) === target) return address;
    }
    return ids.activeAddress(snapshot);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || isDestroyed()) return;
    const snapshot = flow.getSnapshot();
    if (
      !snapshot.open ||
      event.isComposing ||
      event.keyCode === 229 ||
      composing.size > 0 ||
      snapshot.mainFrame.composing ||
      snapshot.actionFrame?.composing
    )
      return;
    const address = eventAddress(event);
    const frame = ids.frame(address);
    const target = eventTarget(event);
    const addressKey = ids.addressKey(address);
    const input = elements.inputs.get(addressKey);
    const search = input === target;
    const document = elements.dialog?.ownerDocument ?? input?.ownerDocument;
    const apple = document ? isApplePlatform(document) : false;
    const bare = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if (event.key === "Escape" && bare) {
      event.preventDefault();
      if (!event.repeat) flow.escape();
      return;
    }
    if (snapshot.confirmation) {
      if (event.key === "Tab" && elements.confirmation)
        trapTabFocus(event, elements.confirmation, scope()?.activeElement, true);
      return;
    }
    if (event.key === "Tab" && elements.dialog) {
      trapTabFocus(event, elements.dialog, scope()?.activeElement);
      return;
    }
    if (actionShortcut && matchesKeybinding(event, actionShortcut, apple)) {
      event.preventDefault();
      if (!event.repeat && frame) {
        if (snapshot.actionFrame) flow.closeActions();
        else flow.openActions(undefined, address);
      }
      return;
    }
    const navigation = search && frame ? listNavigation(event, apple) : undefined;
    if (navigation && frame) {
      effects.setModality("keyboard");
      event.preventDefault();
      if (navigation.kind === "item") {
        flow.moveActive(navigation.direction === 1 ? "next" : "previous", address);
      } else {
        const candidateId =
          navigation.kind === "page"
            ? pageTarget(frame, navigation.direction, elements.lists.get(addressKey), (id) =>
                elements.items.get(ids.itemKey(id, address)),
              )
            : sectionTarget(frame, navigation.direction);
        if (candidateId !== undefined) flow.setActive(candidateId, address);
      }
      return;
    }
    if (
      search &&
      bare &&
      event.key === "Backspace" &&
      frame?.query === "" &&
      options.backspaceToPop
    ) {
      const frames = address.surface === "main" ? snapshot.mainFrames : snapshot.actionFrames;
      if (frames.length > 1) {
        event.preventDefault();
        if (!event.repeat) flow.pop(address.surface);
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
      if (!event.repeat) void flow.invoke({ address, ...(action ? { actionId: action.id } : {}) });
      return;
    }
    if (!frame) return;
    const active = frame.items.find((item) => item.candidateId === frame.activeId);
    const action = [...(active?.actions ?? []), ...frame.actions].find(
      (candidate) => candidate.shortcut && matchesKeybinding(event, candidate.shortcut, apple),
    );
    if (
      action &&
      (!isEditableElement(target) ||
        action.shortcut?.mod ||
        action.shortcut?.ctrl ||
        action.shortcut?.meta ||
        action.shortcut?.alt)
    ) {
      event.preventDefault();
      if (!event.repeat) void flow.invoke({ address, actionId: action.id });
    }
  }

  function handleInput(event: Event, value: Address): void {
    if (event.defaultPrevented) return;
    const target = eventTarget(event);
    if ("isComposing" in event && event.isComposing === true) composing.add(ids.addressKey(value));
    if (isHtmlElement(target) && "value" in target)
      flow.setQuery(String(target.value), ids.address(value), composing.has(ids.addressKey(value)));
  }

  function handleCompositionStart(event: Event, value: Address): void {
    if (!event.defaultPrevented) composing.add(ids.addressKey(value));
  }

  function handleCompositionEnd(event: Event, value: Address): void {
    composing.delete(ids.addressKey(value));
    handleInput(event, value);
  }

  return {
    composing,
    handleKeyDown,
    handleInput,
    handleCompositionStart,
    handleCompositionEnd,
    clear() {
      composing.clear();
    },
  };
}
