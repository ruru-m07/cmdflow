import type {
  CmdFlowActionRunInput as ActionRunInput,
  CmdFlowFieldValue as FieldValue,
  CmdFlowFormField as FormField,
} from "../contracts/definitions.js";

export function initialFieldValue<TContext, TData>(field: FormField<TContext, TData>): FieldValue {
  if (field.defaultValue !== undefined) return field.defaultValue;
  switch (field.type) {
    case "number":
      return 0;
    case "checkbox":
      return false;
    case "multi-select":
      return Object.freeze([]);
    default:
      return "";
  }
}

export function isFieldValueCompatible<TContext, TData>(
  field: FormField<TContext, TData>,
  value: FieldValue,
): boolean {
  switch (field.type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "checkbox":
      return typeof value === "boolean";
    case "multi-select":
      return Array.isArray(value) && value.every((entry) => typeof entry === "string");
    default:
      return typeof value === "string";
  }
}

export async function validateFieldValue<TContext, TData>(
  field: FormField<TContext, TData>,
  value: FieldValue,
  input: ActionRunInput<TContext, TData>,
): Promise<string | undefined> {
  switch (field.type) {
    case "number":
      return typeof value === "number" ? field.validate?.(value, input) : "Expected a number";
    case "checkbox":
      return typeof value === "boolean" ? field.validate?.(value, input) : "Expected a boolean";
    case "multi-select":
      return Array.isArray(value) && value.every((entry) => typeof entry === "string")
        ? field.validate?.(value, input)
        : "Expected a list of values";
    default:
      return typeof value === "string" ? field.validate?.(value, input) : "Expected text";
  }
}
