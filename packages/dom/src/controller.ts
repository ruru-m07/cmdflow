import type { CmdFlow, CmdFlowSnapshot } from "@cmdflow/core";
import { createDomEffects, visuallyHiddenStyle } from "./effects.js";
import { createElementRegistry } from "./element-registry.js";
import { focusElement, getDeepActiveElement } from "./focus.js";
import { createDomIds } from "./ids.js";
import { createKeyboardController, describeKeybinding, matchesKeybinding } from "./keyboard.js";
import { createModalController } from "./modal.js";
import { createNativeController } from "./native-controller.js";
import { createPropBindings } from "./prop-bindings.js";
import type { Cleanup, CmdFlowDomController, DomControllerOptions } from "./types.js";

export type {
  Address,
  CmdFlowDomController,
  DomControllerOptions,
  DomElementBindings,
  DomPropBindings,
  EventMode,
  InputElement,
  VisuallyHiddenStyle,
} from "./types.js";
export { describeKeybinding, matchesKeybinding, visuallyHiddenStyle };

/** Lifecycle binding never assumes a flow notification means a framework has committed. */
export function createDomController<TContext = unknown, TData = unknown>(
  flow: CmdFlow<TContext, TData>,
  options: DomControllerOptions = {},
): CmdFlowDomController {
  const mode = options.eventMode ?? "props";
  const actionShortcut =
    options.actionShortcut === undefined ? { key: "k", mod: true } : options.actionShortcut;
  const cleanups = new Set<Cleanup>();
  const elements = createElementRegistry();
  const ids = createDomIds(flow, options.id);
  const modal = createModalController();
  const openers = new Map<string, HTMLElement | null>();
  let shellOpener: HTMLElement | null = null;
  let committed: CmdFlowSnapshot | null = null;
  let destroyed = false;
  let announcementKey = "";

  function scope(): Document | ShadowRoot | undefined {
    const root = elements.dialog?.getRootNode();
    return (
      options.scope ??
      (root && (root.nodeType === 9 || "host" in root)
        ? (root as Document | ShadowRoot)
        : elements.dialog?.ownerDocument)
    );
  }

  function cleanup(disposeEffect: Cleanup): Cleanup {
    let active = true;
    const dispose = () => {
      if (!active) return;
      active = false;
      cleanups.delete(dispose);
      disposeEffect();
    };
    cleanups.add(dispose);
    return dispose;
  }

  const effects = createDomEffects(ids, elements, () => destroyed);
  const keyboard = createKeyboardController({
    flow,
    options,
    actionShortcut,
    ids,
    elements,
    effects,
    scope,
    isDestroyed: () => destroyed,
  });
  const props = createPropBindings({
    flow,
    options,
    actionShortcut,
    ids,
    elements,
    keyboard,
    effects,
  });

  function restoreAfterDialogUnbind(): void {
    if (committed?.open && !focusElement(shellOpener)) focusElement(options.restoreFocus?.());
    committed = null;
  }

  const native = createNativeController({
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
    sync: () => sync(),
    isDestroyed: () => destroyed,
    restoreAfterDialogUnbind,
  });

  function sync(snapshot = flow.getSnapshot()): void {
    const dialog = elements.dialog;
    if (destroyed || !dialog || (committed && snapshot.revision < committed.revision)) return;
    const previous = committed;
    const root = scope();
    const opened = snapshot.open && !previous?.open;
    const closed = !snapshot.open && previous?.open;
    const oldActive = previous?.activeFrame;
    const newActive = snapshot.activeFrame;
    let restoredFrameFocus = false;
    if (opened) shellOpener = root ? getDeepActiveElement(root) : null;
    if (snapshot.open && newActive.id !== oldActive?.id && !openers.has(newActive.id)) {
      const requestedActionOpener = props.takeRequestedActionOpener();
      openers.set(
        newActive.id,
        newActive.surface === "actions"
          ? (requestedActionOpener ?? (root ? getDeepActiveElement(root) : null))
          : root
            ? getDeepActiveElement(root)
            : null,
      );
    }
    if (mode === "delegate") native.applyAttributes(dialog, props.getDialogProps(snapshot));
    if (elements.confirmation && mode === "delegate")
      native.applyAttributes(elements.confirmation, props.getConfirmationProps(snapshot));
    modal.syncDialog(dialog, snapshot.open);
    for (const frame of [...snapshot.mainFrames, ...snapshot.actionFrames]) {
      const address = { surface: frame.surface, frameId: frame.id };
      const addressKey = ids.addressKey(address);
      const input = elements.inputs.get(addressKey);
      if (input) {
        const inputProps = props.getInputProps(address, snapshot);
        if (mode === "delegate") {
          native.applyAttributes(input, inputProps);
          if (input.value !== frame.query && !keyboard.composing.has(addressKey))
            input.value = frame.query;
        } else if (inputProps["aria-activedescendant"])
          input.setAttribute("aria-activedescendant", inputProps["aria-activedescendant"]);
        else input.removeAttribute("aria-activedescendant");
      }
      const list = elements.lists.get(addressKey);
      if (list && mode === "delegate")
        native.applyAttributes(list, props.getListProps(address, snapshot));
      if (mode === "delegate") {
        const form = elements.forms.get(addressKey);
        if (form) native.applyAttributes(form, props.getFormProps(address, snapshot));
        for (const field of frame.view.fields) {
          const element = elements.fields.get(`${addressKey}:${field.id}`);
          if (!element) continue;
          const fieldProps = props.getFieldProps(field.id, address, snapshot);
          native.applyAttributes(element, fieldProps);
          if (field.type === "checkbox")
            (element as HTMLInputElement).checked = Boolean(fieldProps.checked);
          else if (
            !Array.isArray(fieldProps.value) &&
            element.value !== String(fieldProps.value ?? "")
          )
            element.value = String(fieldProps.value ?? "");
        }
      }
      for (const item of frame.items) {
        const element = elements.items.get(ids.itemKey(item.candidateId, address));
        if (element && mode === "delegate")
          native.applyAttributes(element, props.getItemProps(item.candidateId, address, snapshot));
      }
    }
    if (opened) effects.focusInitial(newActive);
    else if (snapshot.open && oldActive && oldActive.id !== newActive.id) {
      const popping = [...(previous?.mainFrames ?? []), ...(previous?.actionFrames ?? [])].some(
        (frame) => frame.id === newActive.id,
      );
      restoredFrameFocus = popping && focusElement(openers.get(oldActive.id));
      if (!restoredFrameFocus) effects.focusInitial(newActive);
    }
    if (!snapshot.confirmation) modal.releaseConfirmation();
    if (snapshot.confirmation && snapshot.confirmation.id !== previous?.confirmation?.id) {
      openers.set(
        `confirmation:${snapshot.confirmation.id}`,
        root ? getDeepActiveElement(root) : null,
      );
      if (elements.confirmation) modal.activateConfirmation(elements.confirmation);
      focusElement(elements.confirmation);
    } else if (!snapshot.confirmation && previous?.confirmation) {
      if (!focusElement(openers.get(`confirmation:${previous.confirmation.id}`)))
        effects.focusInitial(newActive);
    }
    if (closed) {
      if (!focusElement(shellOpener)) focusElement(options.restoreFocus?.());
      openers.clear();
      keyboard.clear();
      effects.clearStatus();
    }
    if (snapshot.open) {
      const changedActive = newActive.activeId !== oldActive?.activeId;
      if (changedActive || !effects.restoreScroll(newActive)) {
        if (changedActive || newActive.id !== oldActive?.id) effects.scrollActive(newActive);
      }
    }
    committed = snapshot;
    const pendingEffects = flow
      .getDomEffects()
      .filter((effect) => effect.revision <= snapshot.revision);
    const acknowledged: number[] = [];
    for (const effect of pendingEffects) {
      const frame = [...snapshot.mainFrames, ...snapshot.actionFrames].find(
        (candidate) => candidate.id === effect.frameId,
      );
      if (effect.type === "announce") {
        if (snapshot.open && effect.message) effects.announce(effect.message);
        acknowledged.push(effect.id);
      } else if (effect.type === "restore") acknowledged.push(effect.id);
      else if (!snapshot.open || (effect.frameId && frame?.id !== newActive.id))
        acknowledged.push(effect.id);
      else if (effect.type === "focus") {
        const later = pendingEffects.some(
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
        const activeAddress = ids.activeAddress(snapshot);
        const activeAddressKey = ids.addressKey(activeAddress);
        const target =
          effect.target === "confirmation"
            ? elements.confirmation
            : effect.fieldId
              ? elements.fields.get(`${activeAddressKey}:${effect.fieldId}`)
              : effect.target === "form"
                ? (elements.fields.get(`${activeAddressKey}:${newActive.view.fields[0]?.id}`) ??
                  elements.forms.get(activeAddressKey))
                : (elements.inputs.get(activeAddressKey) ??
                  (newActive.view.type !== "list" ? dialog : undefined));
        if (focusElement(target)) acknowledged.push(effect.id);
      } else if (effect.type === "scroll") {
        const targetFrame = frame ?? newActive;
        if (targetFrame.activeId !== oldActive?.activeId || !effects.restoreScroll(targetFrame))
          effects.scrollActive(targetFrame);
        acknowledged.push(effect.id);
      }
      if (snapshot.confirmation && effect.target !== "confirmation") acknowledged.push(effect.id);
    }
    if (acknowledged.length) flow.acknowledgeDomEffects(acknowledged);
    const failed = newActive.sources.filter((source) => source.status === "error").length;
    const loading = newActive.sources.some((source) => source.status === "loading");
    const nextKey = `${newActive.id}:${newActive.query}:${newActive.items.length}:${failed}:${loading}`;
    if (snapshot.open && !newActive.composing && nextKey !== announcementKey) {
      announcementKey = nextKey;
      if (!loading)
        effects.announce(
          `${newActive.items.length} ${newActive.items.length === 1 ? "result" : "results"}.${failed ? ` ${failed} search ${failed === 1 ? "source failed" : "sources failed"}.` : ""}`,
          options.announcementDelay ?? 120,
        );
    }
    const liveFrames = new Set(
      [...snapshot.mainFrames, ...snapshot.actionFrames].map((frame) => frame.id),
    );
    for (const frameId of openers.keys())
      if (!frameId.startsWith("confirmation:") && !liveFrames.has(frameId)) openers.delete(frameId);
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    for (const dispose of [...cleanups]) dispose();
    effects.cancelAnnouncements();
    elements.clear();
    props.clear();
    keyboard.clear();
    openers.clear();
  }

  return {
    getDialogProps: props.getDialogProps,
    getInputProps: props.getInputProps,
    getListProps: props.getListProps,
    getItemProps: props.getItemProps,
    getGroupProps: props.getGroupProps,
    getActionsTriggerProps: props.getActionsTriggerProps,
    getCloseProps: props.getCloseProps,
    getBackProps: props.getBackProps,
    getFormProps: props.getFormProps,
    getFieldProps: props.getFieldProps,
    getFieldErrorProps: props.getFieldErrorProps,
    getStatusProps: props.getStatusProps,
    getConfirmationProps: props.getConfirmationProps,
    bindDialog: native.bindDialog,
    bindInput: native.bindInput,
    bindList: native.bindList,
    registerItem: native.registerItem,
    bindForm: native.bindForm,
    bindField: native.bindField,
    bindStatus: native.bindStatus,
    bindConfirmation: native.bindConfirmation,
    sync,
    destroy,
  };
}
