import type { CandidateId, CmdFlow, CmdFlowSurface } from "@cmdflow/core";
import type { DomEffects } from "./effects.js";
import { visuallyHiddenStyle } from "./effects.js";
import type { ElementRegistry } from "./element-registry.js";
import { isHtmlElement } from "./focus.js";
import type { DomIds } from "./ids.js";
import {
  isApplePlatform,
  type KeyboardController,
  matchesKeybinding,
  registerGlobalShortcut,
} from "./keyboard.js";
import type { ModalController } from "./modal.js";
import type { PropBindingsController } from "./prop-bindings.js";
import type {
  Address,
  Cleanup,
  DomControllerOptions,
  DomElementBindings,
  EventMode,
  InputElement,
} from "./types.js";

export interface NativeDomController extends DomElementBindings {
  applyAttributes(element: HTMLElement, props: object): void;
}

interface NativeControllerDependencies<TContext, TData> {
  readonly flow: CmdFlow<TContext, TData>;
  readonly options: DomControllerOptions;
  readonly mode: EventMode;
  readonly ids: DomIds;
  readonly elements: ElementRegistry;
  readonly keyboard: KeyboardController;
  readonly props: PropBindingsController;
  readonly effects: DomEffects;
  readonly modal: ModalController;
  readonly cleanup: (dispose: Cleanup) => Cleanup;
  readonly sync: () => void;
  readonly isDestroyed: () => boolean;
  readonly restoreAfterDialogUnbind: () => void;
}

function listen(element: EventTarget, name: string, handler: (event: Event) => void): Cleanup {
  element.addEventListener(name, handler);
  return () => element.removeEventListener(name, handler);
}

export function createNativeController<TContext, TData>({
  flow,
  options,
  mode,
  ids,
  elements,
  keyboard,
  props,
  effects,
  modal,
  cleanup,
  sync,
  isDestroyed,
  restoreAfterDialogUnbind,
}: NativeControllerDependencies<TContext, TData>): NativeDomController {
  function applyAttributes(element: HTMLElement, attributes: object): void {
    for (const [name, value] of Object.entries(attributes)) {
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

  function bindDialog(element: HTMLElement): Cleanup {
    if (isDestroyed()) throw new Error("Cannot bind a destroyed CmdFlow DOM controller");
    if (elements.dialog && elements.dialog !== element)
      throw new Error("A CmdFlow controller can bind only one dialog");
    elements.dialog = element;
    const removals: Cleanup[] = [];
    if (!elements.status) {
      elements.internalStatus = element.ownerDocument.createElement("span");
      elements.status = elements.internalStatus;
      applyAttributes(elements.status, props.getStatusProps());
      Object.assign(elements.status.style, visuallyHiddenStyle);
      element.append(elements.status);
    }
    removals.push(
      listen(element, "cancel", (event) => {
        event.preventDefault();
        if (
          keyboard.composing.size === 0 &&
          !flow.getSnapshot().mainFrame.composing &&
          !flow.getSnapshot().actionFrame?.composing
        )
          flow.escape();
      }),
    );
    removals.push(
      listen(element, "close", () => {
        if (!modal.nativeClosing && flow.getSnapshot().open) {
          flow.close();
          if (flow.getSnapshot().open) sync();
        }
      }),
    );
    if (mode === "delegate") {
      removals.push(
        listen(element, "keydown", (event) => keyboard.handleKeyDown(event as KeyboardEvent)),
      );
      for (const eventName of ["click", "pointermove", "pointerdown"]) {
        removals.push(
          listen(element, eventName, (event) => {
            for (const target of event.composedPath()) {
              if (!isHtmlElement(target)) continue;
              const id = target.getAttribute("data-cmdflow-id") as CandidateId | null;
              const frameId = target.getAttribute("data-cmdflow-frame");
              const surface = target.getAttribute("data-cmdflow-surface") as CmdFlowSurface | null;
              if (!id || !frameId || (surface !== "main" && surface !== "actions")) continue;
              const address = { surface, frameId };
              if (elements.items.get(ids.itemKey(id, address)) !== target) continue;
              if (eventName === "click") props.handleItemClick(event, id, address);
              else if (eventName === "pointermove")
                props.handleItemPointerMove(event as PointerEvent, id, address);
              else props.handleItemPointerDown(event as PointerEvent);
              break;
            }
          }),
        );
      }
    }
    if (options.openShortcut) {
      const binding = options.openShortcut;
      removals.push(
        registerGlobalShortcut(element.ownerDocument, {
          priority: options.shortcutPriority ?? 0,
          handle(event) {
            if (
              !matchesKeybinding(event, binding, isApplePlatform(element.ownerDocument)) ||
              flow.getSnapshot().open
            )
              return false;
            event.preventDefault();
            flow.open();
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
      options.onDiagnostic?.("Dialog has no host-provided accessible name; using Command palette.");
    return cleanup(() => {
      for (const remove of removals) remove();
      modal.releaseDialog(element);
      if (elements.internalStatus) {
        elements.internalStatus.remove();
        if (elements.status === elements.internalStatus) elements.status = null;
        elements.internalStatus = null;
      }
      effects.cancelAnnouncements();
      if (elements.dialog === element) elements.dialog = null;
      restoreAfterDialogUnbind();
    });
  }

  function bindInput(element: HTMLInputElement, value: Address = "main"): Cleanup {
    const address = ids.address(value);
    const mapKey = ids.addressKey(address);
    elements.inputs.set(mapKey, element);
    const handlers =
      mode === "delegate"
        ? [
            listen(element, "input", (event) => keyboard.handleInput(event, address)),
            listen(element, "compositionstart", (event) =>
              keyboard.handleCompositionStart(event, address),
            ),
            listen(element, "compositionend", (event) =>
              keyboard.handleCompositionEnd(event, address),
            ),
          ]
        : [];
    return cleanup(() => {
      for (const remove of handlers) remove();
      if (elements.inputs.get(mapKey) === element) elements.inputs.delete(mapKey);
      keyboard.composing.delete(mapKey);
    });
  }

  function bindList(element: HTMLElement, value: Address = "main"): Cleanup {
    const address = ids.address(value);
    const mapKey = ids.addressKey(address);
    elements.lists.set(mapKey, element);
    const unlisten = listen(element, "scroll", () => {
      const frame = ids.frame(address);
      const active = frame?.activeId;
      const option = active ? elements.items.get(ids.itemKey(active, address)) : undefined;
      if (active && option)
        flow.setScrollAnchor(
          {
            candidateId: active,
            offset: option.getBoundingClientRect().top - element.getBoundingClientRect().top,
          },
          address,
        );
    });
    return cleanup(() => {
      unlisten();
      if (elements.lists.get(mapKey) === element) elements.lists.delete(mapKey);
    });
  }

  function registerItem(id: CandidateId, element: HTMLElement, value: Address = "main"): Cleanup {
    const address = ids.address(value);
    const mapKey = ids.itemKey(id, address);
    elements.items.set(mapKey, element);
    return cleanup(() => {
      if (elements.items.get(mapKey) === element) elements.items.delete(mapKey);
      const input = elements.inputs.get(ids.addressKey(address));
      if (input?.getAttribute("aria-activedescendant") === element.id)
        input.removeAttribute("aria-activedescendant");
    });
  }

  function bindForm(element: HTMLFormElement, value: Address = "main"): Cleanup {
    const address = ids.address(value);
    const mapKey = ids.addressKey(address);
    elements.forms.set(mapKey, element);
    const remove =
      mode === "delegate"
        ? listen(element, "submit", props.getFormProps(address).onSubmit)
        : () => {};
    return cleanup(() => {
      remove();
      if (elements.forms.get(mapKey) === element) elements.forms.delete(mapKey);
    });
  }

  function bindField(fieldId: string, element: InputElement, value: Address = "main"): Cleanup {
    const address = ids.address(value);
    const mapKey = `${ids.addressKey(address)}:${fieldId}`;
    elements.fields.set(mapKey, element);
    const remove =
      mode === "delegate"
        ? listen(element, "input", props.getFieldProps(fieldId, address).onInput)
        : () => {};
    return cleanup(() => {
      remove();
      if (elements.fields.get(mapKey) === element) elements.fields.delete(mapKey);
    });
  }

  function bindStatus(element: HTMLElement): Cleanup {
    if (elements.internalStatus) {
      elements.internalStatus.remove();
      elements.internalStatus = null;
    }
    elements.status = element;
    applyAttributes(element, props.getStatusProps());
    Object.assign(element.style, visuallyHiddenStyle);
    return cleanup(() => {
      if (elements.status === element) elements.status = null;
    });
  }

  function bindConfirmation(element: HTMLElement): Cleanup {
    elements.confirmation = element;
    return cleanup(() => {
      if (elements.confirmation === element) {
        elements.confirmation = null;
        modal.releaseConfirmation();
      }
    });
  }

  return {
    applyAttributes,
    bindDialog,
    bindInput,
    bindList,
    registerItem,
    bindForm,
    bindField,
    bindStatus,
    bindConfirmation,
  };
}
