import type {
  CandidateId,
  CmdFlowFieldValue,
  CmdFlowKeybinding,
  CmdFlowSnapshot,
  CmdFlowSurface,
  CmdFlowSurfaceAddress,
} from "@cmdflow/core";

export type Address = CmdFlowSurface | CmdFlowSurfaceAddress;
export type Cleanup = () => void;
export type InputElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
export type EventMode = "props" | "delegate";

export interface DomControllerOptions {
  readonly id?: string;
  readonly eventMode?: EventMode;
  readonly scope?: Document | ShadowRoot;
  readonly label?: string;
  readonly searchLabel?: string;
  readonly actionsLabel?: string;
  readonly backspaceToPop?: boolean;
  readonly openShortcut?: CmdFlowKeybinding | false;
  readonly actionShortcut?: CmdFlowKeybinding | false;
  readonly shortcutPriority?: number;
  readonly restoreFocus?: () => HTMLElement | null;
  readonly announcementDelay?: number;
  readonly onDiagnostic?: (message: string) => void;
}

interface DialogProps {
  readonly "data-cmdflow-root": "";
  readonly "data-state": "open" | "closed";
  readonly "aria-label": string;
  readonly role: "dialog";
  readonly "aria-modal": true | undefined;
  readonly tabIndex: -1;
  readonly onKeyDown: (event: KeyboardEvent) => void;
}

interface InputProps {
  readonly id: string;
  readonly "data-cmdflow-part": "input";
  readonly "data-cmdflow-surface": CmdFlowSurface;
  readonly "data-cmdflow-frame": string;
  readonly role: "combobox";
  readonly type: "text";
  readonly autoComplete: "off";
  readonly autoCorrect: "off";
  readonly spellCheck: false;
  readonly "aria-label": string;
  readonly "aria-autocomplete": "list";
  readonly "aria-expanded": boolean;
  readonly "aria-controls": string;
  readonly "aria-activedescendant": string | undefined;
  readonly value: string;
  readonly onInput: (event: Event) => void;
  readonly onCompositionStart: (event: Event) => void;
  readonly onCompositionEnd: (event: Event) => void;
  readonly onKeyDown: (event: KeyboardEvent) => void;
}

interface ListProps {
  readonly id: string;
  readonly "data-cmdflow-part": "list";
  readonly role: "listbox";
  readonly "aria-label": string;
  readonly "aria-busy": boolean;
  readonly "data-loading": string;
  readonly "aria-multiselectable": true | undefined;
}

interface ItemProps {
  readonly id: string;
  readonly role: "option";
  readonly "data-cmdflow-part": "item";
  readonly "data-cmdflow-id": CandidateId;
  readonly "data-cmdflow-surface": CmdFlowSurface;
  readonly "data-cmdflow-frame": string;
  readonly "data-state": "active" | "inactive";
  readonly "data-disabled": string;
  readonly "aria-disabled": true | undefined;
  readonly "aria-description": string | undefined;
  readonly "aria-selected": boolean | undefined;
  readonly "aria-posinset": number | undefined;
  readonly "aria-setsize": number | undefined;
  readonly onClick: (event: Event) => void;
  readonly onPointerMove: (event: PointerEvent) => void;
  readonly onPointerDown: (event: PointerEvent) => void;
}

interface GroupProps {
  readonly id: string;
  readonly "data-cmdflow-part": "group";
  readonly role: "group";
  readonly "aria-label": string;
}

interface ActionsTriggerProps {
  readonly type: "button";
  readonly "data-cmdflow-part": "actions-trigger";
  readonly "aria-label": "Actions";
  readonly "aria-haspopup": "dialog";
  readonly "aria-expanded": boolean;
  readonly "aria-keyshortcuts": string | undefined;
  readonly onClick: (event: Event) => void;
}

interface ButtonProps {
  readonly type: "button";
  readonly "data-cmdflow-part": "close" | "back";
  readonly "aria-label": string;
  readonly onClick: (event: Event) => void;
}

interface FormProps {
  readonly "data-cmdflow-part": "form";
  readonly "aria-label": string;
  readonly "aria-busy": boolean;
  readonly onSubmit: (event: Event) => void;
}

interface FieldProps {
  readonly id: string;
  readonly name: string;
  readonly "data-cmdflow-part": "field";
  readonly type: "text" | "password" | "email" | "number" | "checkbox" | undefined;
  readonly "aria-label": string;
  readonly "aria-invalid": true | undefined;
  readonly "aria-describedby": string | undefined;
  readonly required: boolean | undefined;
  readonly value: CmdFlowFieldValue | undefined;
  readonly checked: boolean | undefined;
  readonly onInput: (event: Event) => void;
}

interface FieldErrorProps {
  readonly id: string;
  readonly "data-cmdflow-part": "field-error";
}

export interface VisuallyHiddenStyle {
  readonly position: "absolute";
  readonly width: string;
  readonly height: string;
  readonly padding: string;
  readonly margin: string;
  readonly overflow: string;
  readonly clipPath: string;
  readonly whiteSpace: "nowrap";
  readonly border: string;
}

interface StatusProps {
  readonly "data-cmdflow-part": "status";
  readonly role: "status";
  readonly "aria-live": "polite";
  readonly "aria-atomic": true;
  readonly style: VisuallyHiddenStyle;
}

interface ConfirmationProps {
  readonly "data-cmdflow-part": "confirmation";
  readonly role: "alertdialog";
  readonly "aria-label": string;
  readonly "aria-modal": true | undefined;
  readonly tabIndex: -1;
}

export interface DomPropBindings {
  getDialogProps(snapshot?: CmdFlowSnapshot): DialogProps;
  getInputProps(address?: Address, snapshot?: CmdFlowSnapshot): InputProps;
  getListProps(address?: Address, snapshot?: CmdFlowSnapshot): ListProps;
  getItemProps(id: CandidateId, address?: Address, snapshot?: CmdFlowSnapshot): ItemProps;
  getGroupProps(label: string, address?: Address, snapshot?: CmdFlowSnapshot): GroupProps;
  getActionsTriggerProps(snapshot?: CmdFlowSnapshot): ActionsTriggerProps;
  getCloseProps(snapshot?: CmdFlowSnapshot): ButtonProps;
  getBackProps(address?: Address, snapshot?: CmdFlowSnapshot): ButtonProps;
  getFormProps(address?: Address, snapshot?: CmdFlowSnapshot): FormProps;
  getFieldProps(fieldId: string, address?: Address, snapshot?: CmdFlowSnapshot): FieldProps;
  getFieldErrorProps(
    fieldId: string,
    address?: Address,
    snapshot?: CmdFlowSnapshot,
  ): FieldErrorProps;
  getStatusProps(snapshot?: CmdFlowSnapshot): StatusProps;
  getConfirmationProps(snapshot?: CmdFlowSnapshot): ConfirmationProps;
}

export interface DomElementBindings {
  bindDialog(element: HTMLElement): Cleanup;
  bindInput(element: HTMLInputElement, address?: Address): Cleanup;
  bindList(element: HTMLElement, address?: Address): Cleanup;
  registerItem(id: CandidateId, element: HTMLElement, address?: Address): Cleanup;
  bindForm(element: HTMLFormElement, address?: Address): Cleanup;
  bindField(fieldId: string, element: InputElement, address?: Address): Cleanup;
  bindStatus(element: HTMLElement): Cleanup;
  bindConfirmation(element: HTMLElement): Cleanup;
}

export interface CmdFlowDomController extends DomPropBindings, DomElementBindings {
  sync(snapshot?: CmdFlowSnapshot): void;
  destroy(): void;
}
