import type {
  CmdFlowActionDefinition,
  CmdFlowActionEvaluation,
  CmdFlowActionRunInput,
  CmdFlowFieldValue,
} from "../contracts/definitions.js";
import type { CmdFlowDomEffect, CmdFlowExecutionResult } from "../contracts/flow.js";
import type { CmdFlowSurfaceAddress } from "../contracts/primitives.js";
import { immutable } from "../identity.js";
import { isFieldValueCompatible, validateFieldValue } from "./form.js";
import type { Frame } from "./state.js";
import { abortable, errorMessage, terminalResult } from "./utils.js";

export interface FormRuntimeDependencies<TContext, TData> {
  readonly findFrame: (address?: CmdFlowSurfaceAddress) => Frame<TContext, TData> | undefined;
  readonly isDestroyed: () => boolean;
  readonly isFrameAlive: (frame: Frame<TContext, TData>) => boolean;
  readonly getSession: () => number;
  readonly createValidationId: () => string;
  readonly evaluate: (frame: Frame<TContext, TData>) => CmdFlowActionEvaluation<TContext, TData>;
  readonly executeSubmit: (
    frame: Frame<TContext, TData>,
    action: CmdFlowActionDefinition<TContext, TData>,
    submittedVersion: number,
  ) => Promise<CmdFlowExecutionResult>;
  readonly publish: () => void;
  readonly effect: (
    type: CmdFlowDomEffect["type"],
    extras?: Omit<CmdFlowDomEffect, "id" | "revision" | "type">,
  ) => void;
}

export interface FormRuntime {
  setField(fieldId: string, value: CmdFlowFieldValue, address?: CmdFlowSurfaceAddress): void;
  submit(address?: CmdFlowSurfaceAddress): Promise<CmdFlowExecutionResult>;
  getSafeDraft(address?: CmdFlowSurfaceAddress): Readonly<Record<string, CmdFlowFieldValue>>;
  restoreDraft(
    values: Readonly<Record<string, CmdFlowFieldValue>>,
    address?: CmdFlowSurfaceAddress,
  ): void;
}

export function createFormRuntime<TContext, TData>(
  dependencies: FormRuntimeDependencies<TContext, TData>,
): FormRuntime {
  function setField(
    fieldId: string,
    value: CmdFlowFieldValue,
    address?: CmdFlowSurfaceAddress,
  ): void {
    const frame = dependencies.findFrame(address);
    const field =
      frame?.definition.type === "form"
        ? frame.definition.fields.find((entry) => entry.id === fieldId)
        : undefined;
    if (
      !frame ||
      dependencies.isDestroyed() ||
      frame.definition.type !== "form" ||
      !field ||
      !isFieldValueCompatible(field, value)
    )
      return;
    const errors = { ...frame.form.errors };
    delete errors[fieldId];
    frame.validation?.abort();
    frame.formVersion += 1;
    frame.form = immutable({
      ...frame.form,
      values: { ...frame.form.values, [fieldId]: value },
      errors,
      dirty: true,
    });
    dependencies.publish();
  }

  async function submit(address?: CmdFlowSurfaceAddress): Promise<CmdFlowExecutionResult> {
    const frame = dependencies.findFrame(address);
    if (
      !frame ||
      dependencies.isDestroyed() ||
      frame.definition.type !== "form" ||
      !frame.definition.submit ||
      frame.form.submitting
    )
      return terminalResult("", "disabled");
    const controller = new AbortController();
    frame.validation = controller;
    const values = frame.form.values;
    const version = frame.formVersion;
    const originalSession = dependencies.getSession();
    frame.form = immutable({ ...frame.form, submitting: true });
    dependencies.publish();
    const input: CmdFlowActionRunInput<TContext, TData> = {
      ...dependencies.evaluate(frame),
      values,
      signal: controller.signal,
      executionId: dependencies.createValidationId(),
    };
    const errors: Record<string, string> = {};
    try {
      await abortable(
        Promise.all(
          (frame.definition.fields ?? []).map(async (field) => {
            const value = values[field.id] ?? "";
            if (
              field.required &&
              (value === "" || value === false || (Array.isArray(value) && !value.length))
            ) {
              errors[field.id] = `${field.label} is required`;
              return;
            }
            const error = await validateFieldValue(field, value, input);
            if (error) errors[field.id] = error;
          }),
        ),
        controller.signal,
      );
    } catch (error) {
      errors._form = errorMessage(error);
    }
    if (frame.validation === controller) frame.validation = undefined;
    if (
      controller.signal.aborted ||
      !dependencies.isFrameAlive(frame) ||
      originalSession !== dependencies.getSession() ||
      frame.formVersion !== version
    ) {
      if (dependencies.isFrameAlive(frame)) {
        frame.form = immutable({ ...frame.form, submitting: false });
        dependencies.publish();
      }
      return terminalResult(input.executionId, "aborted");
    }
    frame.form = immutable({ ...frame.form, errors, submitting: false });
    if (Object.keys(errors).length) {
      dependencies.effect("focus", {
        frameId: frame.id,
        target: "form",
        fieldId: Object.keys(errors)[0],
      });
      dependencies.effect("announce", { message: "Please correct the form errors" });
      dependencies.publish();
      return terminalResult(input.executionId, "error", "Validation failed");
    }
    frame.form = immutable({ ...frame.form, submitting: true });
    dependencies.publish();
    if (
      !dependencies.isFrameAlive(frame) ||
      originalSession !== dependencies.getSession() ||
      frame.formVersion !== version
    ) {
      if (dependencies.isFrameAlive(frame)) {
        frame.form = immutable({ ...frame.form, submitting: false });
        dependencies.publish();
      }
      return terminalResult(input.executionId, "aborted");
    }
    const result = await dependencies.executeSubmit(frame, frame.definition.submit, version);
    if (dependencies.isFrameAlive(frame)) {
      frame.form = immutable({ ...frame.form, submitting: false });
      dependencies.publish();
    }
    return result;
  }

  function getSafeDraft(
    address?: CmdFlowSurfaceAddress,
  ): Readonly<Record<string, CmdFlowFieldValue>> {
    const frame = dependencies.findFrame(address);
    if (!frame) return Object.freeze({});
    const safe = new Set(
      (frame.definition.fields ?? [])
        .filter((field) => field.type !== "password" && !field.sensitive)
        .map((field) => field.id),
    );
    return immutable(
      Object.fromEntries(Object.entries(frame.form.values).filter(([key]) => safe.has(key))),
    );
  }

  function restoreDraft(
    values: Readonly<Record<string, CmdFlowFieldValue>>,
    address?: CmdFlowSurfaceAddress,
  ): void {
    const frame = dependencies.findFrame(address);
    if (!frame || dependencies.isDestroyed() || frame.definition.type !== "form") return;
    const safeFields = new Map(
      frame.definition.fields
        .filter((field) => field.type !== "password" && !field.sensitive)
        .map((field) => [field.id, field] as const),
    );
    frame.validation?.abort();
    frame.formVersion += 1;
    frame.form = immutable({
      ...frame.form,
      values: {
        ...frame.form.values,
        ...Object.fromEntries(
          Object.entries(values).filter(([key, value]) => {
            const field = safeFields.get(key);
            return field ? isFieldValueCompatible(field, value) : false;
          }),
        ),
      },
      dirty: true,
    });
    dependencies.publish();
  }

  return { setField, submit, getSafeDraft, restoreDraft };
}
