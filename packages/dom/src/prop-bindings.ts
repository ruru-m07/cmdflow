import type {
  CandidateId,
  CmdFlow,
  CmdFlowFieldValue,
  CmdFlowKeybinding,
  CmdFlowSnapshot,
} from "@cmdflow/core";
import type { DomEffects } from "./effects.js";
import { visuallyHiddenStyle } from "./effects.js";
import type { ElementRegistry } from "./element-registry.js";
import { eventTarget, isHtmlElement } from "./focus.js";
import type { DomIds } from "./ids.js";
import { describeKeybinding, isApplePlatform, type KeyboardController } from "./keyboard.js";
import { isNativeDialog } from "./modal.js";
import type { Address, DomControllerOptions, DomPropBindings, InputElement } from "./types.js";

export interface PropBindingsController extends DomPropBindings {
  handleItemClick(event: Event, id: CandidateId, address: Address): void;
  handleItemPointerMove(event: PointerEvent, id: CandidateId, address: Address): void;
  handleItemPointerDown(event: PointerEvent): void;
  takeRequestedActionOpener(): HTMLElement | null;
  clear(): void;
}

interface PropBindingsDependencies<TContext, TData> {
  readonly flow: CmdFlow<TContext, TData>;
  readonly options: DomControllerOptions;
  readonly actionShortcut: CmdFlowKeybinding | false;
  readonly ids: DomIds;
  readonly elements: ElementRegistry;
  readonly keyboard: KeyboardController;
  readonly effects: DomEffects;
}

export function createPropBindings<TContext, TData>({
  flow,
  options,
  actionShortcut,
  ids,
  elements,
  keyboard,
  effects,
}: PropBindingsDependencies<TContext, TData>): PropBindingsController {
  let pointer: { x: number; y: number } | null = null;
  let requestedActionOpener: HTMLElement | null = null;

  function handleItemClick(event: Event, id: CandidateId, value: Address): void {
    if (event.defaultPrevented || keyboard.composing.size || ids.frame(value)?.composing) return;
    flow.setActive(id, ids.address(value));
    void flow.invoke({ address: ids.address(value), candidateId: id });
  }

  function handleItemPointerMove(event: PointerEvent, id: CandidateId, value: Address): void {
    if (event.defaultPrevented || event.pointerType === "touch") return;
    const moved = pointer === null || pointer.x !== event.clientX || pointer.y !== event.clientY;
    pointer = { x: event.clientX, y: event.clientY };
    if (!moved) return;
    effects.setModality("pointer");
    flow.setActive(id, ids.address(value));
  }

  function handleItemPointerDown(event: PointerEvent): void {
    if (!event.defaultPrevented && event.pointerType !== "touch") event.preventDefault();
  }

  function getDialogProps(snapshot = flow.getSnapshot()) {
    return {
      "data-cmdflow-root": "" as const,
      "data-state": snapshot.open ? ("open" as const) : ("closed" as const),
      "aria-label": options.label ?? "Command palette",
      role: "dialog" as const,
      "aria-modal": snapshot.open ? (true as const) : undefined,
      tabIndex: -1 as const,
      onKeyDown: keyboard.handleKeyDown,
    };
  }

  function getInputProps(value: Address = "main", snapshot = flow.getSnapshot()) {
    const frame = ids.frame(value, snapshot);
    const address = ids.address(value, snapshot);
    const mounted = frame?.activeId
      ? elements.items.get(ids.itemKey(frame.activeId, address, snapshot))
      : undefined;
    const input = elements.inputs.get(ids.addressKey(address));
    const list = elements.lists.get(ids.addressKey(address));
    const dialog = elements.dialog;
    const referenceValid =
      mounted?.isConnected &&
      list?.isConnected &&
      list.contains(mounted) &&
      (!input || input.getRootNode() === mounted.getRootNode()) &&
      (!dialog || !isNativeDialog(dialog) || dialog.contains(mounted));
    const activeId = referenceValid
      ? ids.partId("item", address, frame?.activeId ?? "", snapshot)
      : undefined;
    return {
      id: ids.partId("input", address, "", snapshot),
      "data-cmdflow-part": "input" as const,
      "data-cmdflow-surface": address.surface,
      "data-cmdflow-frame": address.frameId,
      role: "combobox" as const,
      type: "text" as const,
      autoComplete: "off" as const,
      autoCorrect: "off" as const,
      spellCheck: false as const,
      "aria-label":
        address.surface === "actions"
          ? (options.actionsLabel ?? "Search actions")
          : (options.searchLabel ?? "Search commands"),
      "aria-autocomplete": "list" as const,
      "aria-expanded": snapshot.open && frame !== undefined,
      "aria-controls": ids.partId("list", address, "", snapshot),
      "aria-activedescendant": activeId,
      value: frame?.query ?? "",
      onInput: (event: Event) => keyboard.handleInput(event, address),
      onCompositionStart: (event: Event) => keyboard.handleCompositionStart(event, address),
      onCompositionEnd: (event: Event) => keyboard.handleCompositionEnd(event, address),
      onKeyDown: keyboard.handleKeyDown,
    };
  }

  function getListProps(value: Address = "main", snapshot = flow.getSnapshot()) {
    const frame = ids.frame(value, snapshot);
    return {
      id: ids.partId("list", value, "", snapshot),
      "data-cmdflow-part": "list" as const,
      role: "listbox" as const,
      "aria-label":
        frame?.view.title ||
        (ids.address(value, snapshot).surface === "actions" ? "Actions" : "Results"),
      "aria-busy": frame?.sources.some((source) => source.status === "loading") ?? false,
      "data-loading": String(frame?.sources.some((source) => source.status === "loading") ?? false),
      "aria-multiselectable":
        frame?.view.selectionMode === "multiple" ? (true as const) : undefined,
    };
  }

  function getItemProps(id: CandidateId, value: Address = "main", snapshot = flow.getSnapshot()) {
    const frame = ids.frame(value, snapshot);
    const index = frame?.items.findIndex((item) => item.candidateId === id) ?? -1;
    const item = index >= 0 ? frame?.items[index] : undefined;
    const address = ids.address(value, snapshot);
    return {
      id: ids.partId("item", address, id, snapshot),
      role: "option" as const,
      "data-cmdflow-part": "item" as const,
      "data-cmdflow-id": id,
      "data-cmdflow-surface": address.surface,
      "data-cmdflow-frame": address.frameId,
      "data-state": frame?.activeId === id ? ("active" as const) : ("inactive" as const),
      "data-disabled": String(item?.disabled ?? false),
      "aria-disabled": item?.disabled ? (true as const) : undefined,
      "aria-description": item?.disabledReason,
      "aria-selected":
        frame?.view.selectionMode !== "none" ? frame?.selectedIds.includes(id) : undefined,
      "aria-posinset": index >= 0 ? index + 1 : undefined,
      "aria-setsize": frame?.sources.some(
        (source) => source.status === "loading" || source.nextCursor !== undefined,
      )
        ? -1
        : frame?.items.length,
      onClick: (event: Event) => handleItemClick(event, id, address),
      onPointerMove: (event: PointerEvent) => handleItemPointerMove(event, id, address),
      onPointerDown: handleItemPointerDown,
    };
  }

  function getGroupProps(label: string, value: Address = "main", snapshot = flow.getSnapshot()) {
    return {
      id: ids.partId("group", value, label, snapshot),
      "data-cmdflow-part": "group" as const,
      role: "group" as const,
      "aria-label": label,
    };
  }

  function getActionsTriggerProps(snapshot = flow.getSnapshot()) {
    const dialog = elements.dialog;
    const shortcut = actionShortcut
      ? describeKeybinding(actionShortcut, dialog ? isApplePlatform(dialog.ownerDocument) : false)
      : undefined;
    return {
      type: "button" as const,
      "data-cmdflow-part": "actions-trigger" as const,
      "aria-label": "Actions" as const,
      "aria-haspopup": "dialog" as const,
      "aria-expanded": snapshot.actionFrame !== null,
      "aria-keyshortcuts": shortcut,
      onClick: (event: Event) => {
        if (event.defaultPrevented) return;
        if (flow.getSnapshot().actionFrame) {
          flow.closeActions();
          return;
        }
        requestedActionOpener =
          event
            .composedPath()
            .find(
              (target): target is HTMLElement =>
                isHtmlElement(target) &&
                target.getAttribute("data-cmdflow-part") === "actions-trigger",
            ) ?? null;
        flow.openActions(undefined, ids.address("main"));
        if (!flow.getSnapshot().actionFrame) requestedActionOpener = null;
      },
    };
  }

  function getCloseProps(_snapshot = flow.getSnapshot()) {
    return {
      type: "button" as const,
      "data-cmdflow-part": "close" as const,
      "aria-label": "Close command palette",
      onClick: (event: Event) => {
        if (!event.defaultPrevented) flow.close();
      },
    };
  }

  function getBackProps(value: Address = "main", snapshot = flow.getSnapshot()) {
    const address = ids.address(value, snapshot);
    return {
      type: "button" as const,
      "data-cmdflow-part": "back" as const,
      "aria-label": "Go back",
      onClick: (event: Event) => {
        if (!event.defaultPrevented) flow.pop(address.surface);
      },
    };
  }

  function getFormProps(value: Address = "main", snapshot = flow.getSnapshot()) {
    const frame = ids.frame(value, snapshot);
    const address = ids.address(value, snapshot);
    return {
      "data-cmdflow-part": "form" as const,
      "aria-label": frame?.view.title || "Command form",
      "aria-busy": frame?.form.submitting ?? false,
      onSubmit: (event: Event) => {
        if (event.defaultPrevented) return;
        event.preventDefault();
        void flow.submitForm(address);
      },
    };
  }

  function getFieldProps(fieldId: string, value: Address = "main", snapshot = flow.getSnapshot()) {
    const frame = ids.frame(value, snapshot);
    const field = frame?.view.fields.find((candidate) => candidate.id === fieldId);
    const address = ids.address(value, snapshot);
    const error = frame?.form.errors[fieldId];
    return {
      id: ids.partId("field", address, fieldId, snapshot),
      name: fieldId,
      "data-cmdflow-part": "field" as const,
      type:
        field?.type === "textarea" || field?.type === "select" || field?.type === "multi-select"
          ? undefined
          : (field?.type ?? "text"),
      "aria-label": field?.label ?? fieldId,
      "aria-invalid": error ? (true as const) : undefined,
      "aria-describedby": error ? ids.partId("field-error", address, fieldId, snapshot) : undefined,
      required: field?.required,
      value: field?.type === "checkbox" ? undefined : (frame?.form.values[fieldId] ?? ""),
      checked: field?.type === "checkbox" ? Boolean(frame?.form.values[fieldId]) : undefined,
      onInput: (event: Event) => {
        if (event.defaultPrevented) return;
        const target = eventTarget(event) as InputElement | null;
        if (!target || !("value" in target)) return;
        let next: CmdFlowFieldValue = target.value;
        if (target.tagName === "INPUT" && (target as HTMLInputElement).type === "checkbox")
          next = (target as HTMLInputElement).checked;
        else if (target.tagName === "INPUT" && (target as HTMLInputElement).type === "number")
          next = (target as HTMLInputElement).valueAsNumber;
        else if (target.tagName === "SELECT" && (target as HTMLSelectElement).multiple)
          next = [...(target as HTMLSelectElement).selectedOptions].map((option) => option.value);
        flow.setField(fieldId, next, address);
      },
    };
  }

  function getFieldErrorProps(
    fieldId: string,
    value: Address = "main",
    snapshot = flow.getSnapshot(),
  ) {
    return {
      id: ids.partId("field-error", value, fieldId, snapshot),
      "data-cmdflow-part": "field-error" as const,
    };
  }

  function getStatusProps(_snapshot = flow.getSnapshot()) {
    return {
      "data-cmdflow-part": "status" as const,
      role: "status" as const,
      "aria-live": "polite" as const,
      "aria-atomic": true as const,
      style: visuallyHiddenStyle,
    };
  }

  function getConfirmationProps(snapshot: CmdFlowSnapshot = flow.getSnapshot()) {
    return {
      "data-cmdflow-part": "confirmation" as const,
      role: "alertdialog" as const,
      "aria-label": snapshot.confirmation?.title ?? "Confirm action",
      "aria-modal": snapshot.confirmation ? (true as const) : undefined,
      tabIndex: -1 as const,
    };
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
    handleItemClick,
    handleItemPointerMove,
    handleItemPointerDown,
    takeRequestedActionOpener() {
      const opener = requestedActionOpener;
      requestedActionOpener = null;
      return opener;
    },
    clear() {
      pointer = null;
      requestedActionOpener = null;
    },
  };
}
