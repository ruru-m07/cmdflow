import type { CmdFlow, CmdFlowSnapshot } from "@cmdflow/core";
import { createDomEffects } from "./effects.js";
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
} from "./types.js";
export { describeKeybinding, matchesKeybinding };

interface FrameOpener {
  readonly frameId: string;
  readonly element: HTMLElement;
}

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
  const openers = new Map<string, FrameOpener>();
  let shellOpener: HTMLElement | null = null;
  let confirmationOpener: HTMLElement | null = null;
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
    const frames = [...snapshot.mainFrames, ...snapshot.actionFrames];
    const previousFrames =
      newActive.surface === "main" ? previous?.mainFrames : previous?.actionFrames;
    const previousFrame = previousFrames?.find((frame) => frame.id === newActive.id);
    const frameChanged = newActive.id !== oldActive?.id;
    const queryChanged =
      previousFrame !== undefined &&
      !newActive.composing &&
      (newActive.query !== previousFrame.query || previousFrame.composing);
    const returning = previous?.open === true && frameChanged && previousFrame !== undefined;
    let shouldScroll =
      opened || frameChanged || queryChanged || newActive.activeId !== oldActive?.activeId;
    let restoredFrameFocus = false;
    if (opened) shellOpener = root ? getDeepActiveElement(root) : null;
    if (snapshot.open && previous?.open && oldActive && frameChanged && !returning) {
      const requestedOpener =
        newActive.surface === "actions" ? props.takeRequestedActionOpener() : null;
      const opener =
        requestedOpener ??
        (oldActive.view.type !== "list" && root ? getDeepActiveElement(root) : null);
      if (opener) openers.set(newActive.id, { frameId: oldActive.id, element: opener });
    }
    if (mode === "delegate") native.applyAttributes(dialog, props.getDialogProps(snapshot));
    if (elements.confirmation && mode === "delegate")
      native.applyAttributes(elements.confirmation, props.getConfirmationProps(snapshot));
    modal.syncDialog(dialog, snapshot.open);
    for (const frame of frames) {
      const address = { surface: frame.surface, frameId: frame.id };
      const addressKey = ids.addressKey(address);
      if (mode === "delegate") {
        const list = elements.lists.get(addressKey);
        if (list) native.applyAttributes(list, props.getListProps(address, snapshot));
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
        for (const item of frame.items) {
          const element = elements.items.get(ids.itemKey(item.candidateId, address));
          if (element)
            native.applyAttributes(
              element,
              props.getItemProps(item.candidateId, address, snapshot),
            );
        }
      }
      const input = elements.inputs.get(addressKey);
      if (input) {
        if (mode === "delegate") {
          native.applyAttributes(input, props.getInputProps(address, snapshot));
          if (input.value !== frame.query && !keyboard.composing.has(addressKey))
            input.value = frame.query;
        } else native.syncActiveDescendant(address, snapshot);
      }
    }
    if (opened) effects.focusInitial(newActive);
    else if (snapshot.open && oldActive && frameChanged) {
      const departingFrame =
        oldActive.surface === "actions" && newActive.surface === "main"
          ? previous?.actionFrames[0]
          : oldActive;
      const opener = departingFrame && openers.get(departingFrame.id);
      restoredFrameFocus = Boolean(
        returning && opener?.frameId === newActive.id && focusElement(opener.element),
      );
      if (!restoredFrameFocus) effects.focusInitial(newActive);
    }
    if (!snapshot.confirmation) modal.releaseConfirmation();
    if (snapshot.confirmation && snapshot.confirmation.id !== previous?.confirmation?.id) {
      confirmationOpener = root ? getDeepActiveElement(root) : null;
      if (elements.confirmation) modal.activateConfirmation(elements.confirmation);
      focusElement(elements.confirmation);
    } else if (!snapshot.confirmation && previous?.confirmation) {
      if (!frameChanged && !focusElement(confirmationOpener)) effects.focusInitial(newActive);
      confirmationOpener = null;
    }
    if (closed) {
      if (!focusElement(shellOpener)) focusElement(options.restoreFocus?.());
      shellOpener = null;
      openers.clear();
      keyboard.clear();
      props.clear();
      effects.clearStatus();
    }
    committed = snapshot;
    const pendingEffects = flow
      .getDomEffects()
      .filter((effect) => effect.revision <= snapshot.revision);
    const acknowledged: number[] = [];
    for (const effect of pendingEffects) {
      if (effect.type === "announce") {
        if (snapshot.open && effect.message) effects.announce(effect.message);
        acknowledged.push(effect.id);
      } else if (effect.type === "restore") acknowledged.push(effect.id);
      else if (!snapshot.open || (effect.frameId && effect.frameId !== newActive.id))
        acknowledged.push(effect.id);
      else if (effect.type === "focus") {
        const later = pendingEffects.some(
          (candidate) => candidate.type === "focus" && candidate.id > effect.id,
        );
        if (later) {
          acknowledged.push(effect.id);
          continue;
        }
        if (restoredFrameFocus && effect.target !== "confirmation" && !effect.fieldId) {
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
        shouldScroll = true;
        acknowledged.push(effect.id);
      }
      if (snapshot.confirmation && effect.target !== "confirmation") acknowledged.push(effect.id);
    }
    if (snapshot.open && shouldScroll) {
      if (!returning || queryChanged || !effects.restoreScroll(newActive)) {
        if (opened || frameChanged || queryChanged) effects.resetScroll(newActive);
        effects.scrollActive(newActive);
      }
      effects.rememberScroll(newActive);
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
    const liveFrames = new Set(snapshot.open ? frames.map((frame) => frame.id) : []);
    for (const frameId of openers.keys()) if (!liveFrames.has(frameId)) openers.delete(frameId);
    effects.retainScroll(liveFrames);
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
    effects.retainScroll(new Set());
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
