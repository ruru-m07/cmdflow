import type {
  CmdFlowActionDefinition as ActionDefinition,
  CmdFlowCommandDefinition as CommandDefinition,
  CmdFlowExtensionDefinition as ExtensionDefinition,
  CmdFlowFormField as FormField,
  CmdFlowResultSource as ResultSource,
  CmdFlowViewDefinition as ViewDefinition,
} from "../contracts/definitions.js";
import { immutable } from "../identity.js";

function assertRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
}

function assertIdentifier(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
}

function assertFunction(
  value: unknown,
  path: string,
): asserts value is (...args: never[]) => unknown {
  if (typeof value !== "function") throw new TypeError(`${path} must be a function`);
}

function assertArray(value: unknown, path: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
}

function assertUniqueIds(values: readonly { readonly id: string }[], path: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) throw new TypeError(`Duplicate CmdFlow id at ${path}: ${value.id}`);
    seen.add(value.id);
  }
}

function assertAbsent(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const unexpected = keys.find((key) => value[key] !== undefined);
  if (unexpected) throw new TypeError(`${path}.${unexpected} is not valid for this definition`);
}

function assertOptionalFiniteNumber(value: unknown, path: string, minimum?: number): void {
  if (value === undefined) return;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (minimum !== undefined && value < minimum)
  ) {
    throw new TypeError(
      minimum === undefined
        ? `${path} must be a finite number`
        : `${path} must be a finite number greater than or equal to ${minimum}`,
    );
  }
}

function validateAction<TContext, TData>(
  action: ActionDefinition<TContext, TData>,
  path: string,
): void {
  assertRecord(action, path);
  assertIdentifier(action.id, `${path}.id`);
  assertIdentifier(action.title, `${path}.title`);
  if (action.visible !== undefined) assertFunction(action.visible, `${path}.visible`);
  if (action.enabled !== undefined) assertFunction(action.enabled, `${path}.enabled`);
  if (
    action.priority !== undefined &&
    !["primary", "secondary", "auxiliary"].includes(action.priority)
  ) {
    throw new TypeError(`${path}.priority is not supported`);
  }
  if (
    action.lifecycle !== undefined &&
    action.lifecycle !== "origin-bound" &&
    action.lifecycle !== "detached"
  ) {
    throw new TypeError(`${path}.lifecycle is not supported`);
  }

  switch (action.type) {
    case "run":
      assertAbsent(action, ["actions", "children", "view", "target"], path);
      assertFunction(action.run, `${path}.run`);
      break;
    case "submenu":
      assertAbsent(action, ["children", "run", "view", "target"], path);
      assertArray(action.actions, `${path}.actions`);
      action.actions.forEach((child, index) => {
        validateAction(child, `${path}.actions[${index}]`);
      });
      assertUniqueIds(action.actions, `${path}.actions`);
      break;
    case "view":
      assertAbsent(action, ["actions", "children", "run"], path);
      if (
        action.target !== undefined &&
        action.target !== "main" &&
        action.target !== "actions" &&
        action.target !== "origin"
      ) {
        throw new TypeError(`${path}.target is not a CmdFlow surface`);
      }
      validateView(action.view, `${path}.view`);
      break;
    default:
      throw new TypeError(`${path}.type must be "run", "submenu", or "view"`);
  }
}

function validateCommand<TContext, TData>(
  command: CommandDefinition<TContext, TData>,
  path: string,
): void {
  assertRecord(command, path);
  assertIdentifier(command.id, `${path}.id`);
  assertIdentifier(command.title, `${path}.title`);
  assertAbsent(command, ["type", "run", "view", "children"], path);
  if (command.visible !== undefined) assertFunction(command.visible, `${path}.visible`);
  if (command.enabled !== undefined) assertFunction(command.enabled, `${path}.enabled`);
  if (command.action) validateAction(command.action, `${path}.action`);
  if (command.actions) {
    assertArray(command.actions, `${path}.actions`);
    command.actions.forEach((action, index) => {
      validateAction(action, `${path}.actions[${index}]`);
    });
    assertUniqueIds(command.actions, `${path}.actions`);
  }
}

function validateField<TContext, TData>(field: FormField<TContext, TData>, path: string): void {
  assertRecord(field, path);
  assertIdentifier(field.id, `${path}.id`);
  assertIdentifier(field.label, `${path}.label`);
  if (field.validate !== undefined) assertFunction(field.validate, `${path}.validate`);
  switch (field.type) {
    case "text":
    case "password":
    case "email":
    case "textarea":
      if (field.defaultValue !== undefined && typeof field.defaultValue !== "string") {
        throw new TypeError(`${path}.defaultValue must be a string`);
      }
      break;
    case "number":
      if (field.defaultValue !== undefined && typeof field.defaultValue !== "number") {
        throw new TypeError(`${path}.defaultValue must be a number`);
      }
      break;
    case "checkbox":
      if (field.defaultValue !== undefined && typeof field.defaultValue !== "boolean") {
        throw new TypeError(`${path}.defaultValue must be a boolean`);
      }
      break;
    case "select":
    case "multi-select":
      assertArray(field.options, `${path}.options`);
      for (const [index, option] of field.options.entries()) {
        assertRecord(option, `${path}.options[${index}]`);
        assertIdentifier(option.value, `${path}.options[${index}].value`);
        assertIdentifier(option.label, `${path}.options[${index}].label`);
      }
      assertUniqueIds(
        field.options.map((option) => ({ id: option.value })),
        `${path}.options`,
      );
      if (
        field.defaultValue !== undefined &&
        (field.type === "select"
          ? typeof field.defaultValue !== "string"
          : !Array.isArray(field.defaultValue) ||
            field.defaultValue.some((value) => typeof value !== "string"))
      ) {
        throw new TypeError(`${path}.defaultValue does not match ${field.type}`);
      }
      break;
    default:
      throw new TypeError(`${path}.type is not a supported CmdFlow form field`);
  }
}

function validateView<TContext, TData>(view: ViewDefinition<TContext, TData>, path: string): void {
  assertRecord(view, path);
  assertIdentifier(view.id, `${path}.id`);
  assertAbsent(view, ["rendererKey", "payloadKey"], path);
  if (view.actions) {
    assertArray(view.actions, `${path}.actions`);
    view.actions.forEach((action, index) => {
      validateAction(action, `${path}.actions[${index}]`);
    });
    assertUniqueIds(view.actions, `${path}.actions`);
  }
  if (view.renderer) {
    assertRecord(view.renderer, `${path}.renderer`);
    assertIdentifier(view.renderer.key, `${path}.renderer.key`);
  }

  switch (view.type) {
    case "list":
      assertAbsent(view, ["fields", "submit"], path);
      if (
        view.selectionMode !== undefined &&
        view.selectionMode !== "none" &&
        view.selectionMode !== "single" &&
        view.selectionMode !== "multiple"
      ) {
        throw new TypeError(`${path}.selectionMode is not supported`);
      }
      if (view.items) {
        assertArray(view.items, `${path}.items`);
        view.items.forEach((command, index) => {
          validateCommand(command, `${path}.items[${index}]`);
        });
        assertUniqueIds(view.items, `${path}.items`);
      }
      if (view.sourceIds) {
        assertArray(view.sourceIds, `${path}.sourceIds`);
        const sourceIds = view.sourceIds.map((sourceId, index) => {
          assertIdentifier(sourceId, `${path}.sourceIds[${index}]`);
          return { id: sourceId };
        });
        assertUniqueIds(sourceIds, `${path}.sourceIds`);
      }
      break;
    case "detail":
      assertAbsent(view, ["fields", "items", "sourceIds", "submit", "selectionMode"], path);
      break;
    case "form":
      assertAbsent(view, ["items", "sourceIds", "selectionMode", "learnableQuery"], path);
      assertArray(view.fields, `${path}.fields`);
      view.fields.forEach((field, index) => {
        validateField(field, `${path}.fields[${index}]`);
      });
      assertUniqueIds(view.fields, `${path}.fields`);
      validateAction(view.submit, `${path}.submit`);
      if (view.submit.type !== "run") throw new TypeError(`${path}.submit must be a run action`);
      break;
    case "custom":
      assertAbsent(
        view,
        ["fields", "items", "sourceIds", "submit", "selectionMode", "learnableQuery"],
        path,
      );
      if (!view.renderer) throw new TypeError(`${path}.renderer is required for a custom view`);
      break;
    default:
      throw new TypeError(`${path}.type is not a supported CmdFlow view`);
  }
}

export function normalizeActionDefinition<TContext, TData>(
  action: ActionDefinition<TContext, TData>,
  path = "action",
): ActionDefinition<TContext, TData> {
  validateAction(action, path);
  return immutable(action);
}

export function normalizeCommandDefinition<TContext, TData>(
  command: CommandDefinition<TContext, TData>,
  path = "command",
): CommandDefinition<TContext, TData> {
  validateCommand(command, path);
  return immutable(command);
}

export function normalizeViewDefinition<TContext, TData>(
  view: ViewDefinition<TContext, TData>,
  path = "view",
): ViewDefinition<TContext, TData> {
  validateView(view, path);
  return immutable(view);
}

export function normalizeResultSource<TContext, TData>(
  source: ResultSource<TContext, TData>,
  path = "source",
): ResultSource<TContext, TData> {
  assertRecord(source, path);
  assertIdentifier(source.id, `${path}.id`);
  assertFunction(source.search, `${path}.search`);
  assertOptionalFiniteNumber(source.sourcePriority, `${path}.sourcePriority`);
  assertOptionalFiniteNumber(source.debounceMs, `${path}.debounceMs`, 0);
  assertOptionalFiniteNumber(source.minQueryLength, `${path}.minQueryLength`, 0);
  assertOptionalFiniteNumber(source.limit, `${path}.limit`, 0);
  if (
    source.remoteQuery !== undefined &&
    source.remoteQuery !== "raw" &&
    source.remoteQuery !== "normalized" &&
    source.remoteQuery !== "none"
  ) {
    throw new TypeError(`${path}.remoteQuery is not supported`);
  }
  return immutable(source);
}

export function normalizeExtensionDefinition<TContext, TData>(
  extension: ExtensionDefinition<TContext, TData>,
): ExtensionDefinition<TContext, TData> {
  assertRecord(extension, "extension");
  assertIdentifier(extension.id, "extension.id");
  const commands = (extension.commands ?? []).map((command, index) =>
    normalizeCommandDefinition(command, `extension.commands[${index}]`),
  );
  const sources = (extension.sources ?? []).map((source, index) =>
    normalizeResultSource(source, `extension.sources[${index}]`),
  );
  assertUniqueIds(commands, "extension.commands");
  assertUniqueIds(sources, "extension.sources");
  return immutable({ ...extension, commands, sources });
}

export function commandFromAction<TContext, TData>(
  action: ActionDefinition<TContext, TData>,
): CommandDefinition<TContext, TData> {
  return immutable({
    id: action.id,
    title: action.title,
    subtitle: action.subtitle,
    keywords: action.keywords,
    shortcut: action.shortcut,
    section: action.section,
    visible: action.visible,
    enabled: action.enabled,
    action,
  });
}
