import { Root } from "../context.js";
import {
  Empty,
  Error as ErrorPrimitive,
  Group,
  Input,
  Item,
  List,
  Loading,
  LoadMore,
  SelectionIndicator,
  Separator,
  Shortcut,
} from "./collection.js";
import { CancelConfirmation, Confirm, Confirmation, Status, View } from "./feedback.js";
import { Field, FieldError, FieldLabel, Form, Select, Textarea } from "./forms.js";
import {
  ActionPanel,
  ActionPanelTrigger,
  Actions,
  ActionsTrigger,
  Back,
  Close,
  Dialog,
  Trigger,
} from "./navigation.js";

export * from "./collection.js";
export * from "./feedback.js";
export * from "./forms.js";
export * from "./navigation.js";

export interface CommandPrimitives {
  readonly Root: typeof Root;
  readonly Trigger: typeof Trigger;
  readonly Dialog: typeof Dialog;
  readonly View: typeof View;
  readonly Input: typeof Input;
  readonly List: typeof List;
  readonly Group: typeof Group;
  readonly Item: typeof Item;
  readonly Empty: typeof Empty;
  readonly Loading: typeof Loading;
  readonly Error: typeof ErrorPrimitive;
  readonly LoadMore: typeof LoadMore;
  readonly Separator: typeof Separator;
  readonly Shortcut: typeof Shortcut;
  readonly SelectionIndicator: typeof SelectionIndicator;
  readonly ActionPanel: typeof ActionPanel;
  readonly ActionPanelTrigger: typeof ActionPanelTrigger;
  /** @deprecated Use ActionPanel. */
  readonly Actions: typeof Actions;
  /** @deprecated Use ActionPanelTrigger. */
  readonly ActionsTrigger: typeof ActionsTrigger;
  readonly Close: typeof Close;
  readonly Back: typeof Back;
  readonly Form: typeof Form;
  readonly Field: typeof Field;
  readonly Textarea: typeof Textarea;
  readonly Select: typeof Select;
  readonly FieldLabel: typeof FieldLabel;
  readonly FieldError: typeof FieldError;
  readonly Confirm: typeof Confirm;
  readonly CancelConfirmation: typeof CancelConfirmation;
  readonly Status: typeof Status;
  readonly Confirmation: typeof Confirmation;
}

export const Command: CommandPrimitives = {
  Root,
  Trigger,
  Dialog,
  View,
  Input,
  List,
  Group,
  Item,
  Empty,
  Loading,
  Error: ErrorPrimitive,
  LoadMore,
  Separator,
  Shortcut,
  SelectionIndicator,
  ActionPanel,
  ActionPanelTrigger,
  Actions,
  ActionsTrigger,
  Close,
  Back,
  Form,
  Field,
  Textarea,
  Select,
  FieldLabel,
  FieldError,
  Confirm,
  CancelConfirmation,
  Status,
  Confirmation,
};
