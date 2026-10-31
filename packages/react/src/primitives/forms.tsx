"use client";

import type { CmdFlowViewSnapshot } from "@cmdflow/core";
import {
  type ComponentPropsWithoutRef,
  createElement,
  forwardRef,
  type Ref,
  useCallback,
} from "react";

import { useElementBinding } from "../bindings.js";
import { mergeProps } from "../merge-props.js";
import { frameFor, useCmdFlowSelector, useCommandContext, useSurface } from "../selectors.js";
import type { BoundProps, SurfaceProps } from "./shared.js";

export const Form = forwardRef<HTMLFormElement, ComponentPropsWithoutRef<"form"> & SurfaceProps>(
  (props, forwardedRef) => {
    const { surface: requestedSurface, ...consumer } = props;
    const surface = useSurface(requestedSurface);
    const { controller } = useCommandContext();
    const selected = useCmdFlowSelector(
      (snapshot) => ({ snapshot, frame: frameFor(snapshot, surface) }),
      undefined,
      (left, right) => left.frame === right.frame,
    );
    const bind = useCallback(
      (element: HTMLFormElement) =>
        controller.bindForm(
          element,
          selected.frame?.id ? { surface, frameId: selected.frame.id } : surface,
        ),
      [controller, selected.frame?.id, surface],
    );
    const ref = useElementBinding(bind, forwardedRef);
    return createElement("form", {
      noValidate: true,
      ...mergeProps(controller.getFormProps(surface, selected.snapshot), consumer),
      ref,
    });
  },
);
Form.displayName = "Command.Form";

export type FieldProps = ComponentPropsWithoutRef<"input"> &
  SurfaceProps & { readonly fieldId: string };

export function useFieldProps(
  props: FieldProps,
  forwardedRef?: Ref<HTMLInputElement>,
): BoundProps<HTMLInputElement, ComponentPropsWithoutRef<"input">> {
  const { fieldId, surface: requestedSurface, ...consumer } = props;
  const surface = useSurface(requestedSurface);
  const { controller } = useCommandContext();
  const selected = useCmdFlowSelector(
    (snapshot) => ({ snapshot, frame: frameFor(snapshot, surface) }),
    undefined,
    (left, right) => left.frame === right.frame,
  );
  const bind = useCallback(
    (element: HTMLInputElement) =>
      controller.bindField(
        fieldId,
        element,
        selected.frame?.id ? { surface, frameId: selected.frame.id } : surface,
      ),
    [controller, fieldId, selected.frame?.id, surface],
  );
  const ref = useElementBinding(bind, forwardedRef);
  return {
    ...mergeProps(controller.getFieldProps(fieldId, surface, selected.snapshot), consumer),
    ref,
  };
}

export const Field = forwardRef<HTMLInputElement, FieldProps>((props, ref) =>
  createElement("input", useFieldProps(props, ref)),
);
Field.displayName = "Command.Field";

type NamedField = SurfaceProps & { readonly fieldId: string };

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  ComponentPropsWithoutRef<"textarea"> & NamedField
>((props, forwardedRef) => {
  const { fieldId, surface: requestedSurface, ...consumer } = props;
  const surface = useSurface(requestedSurface);
  const { controller } = useCommandContext();
  const selected = useCmdFlowSelector(
    (snapshot) => ({ snapshot, frame: frameFor(snapshot, surface) }),
    undefined,
    (left, right) => left.frame === right.frame,
  );
  const bind = useCallback(
    (element: HTMLTextAreaElement) =>
      controller.bindField(
        fieldId,
        element,
        selected.frame?.id ? { surface, frameId: selected.frame.id } : surface,
      ),
    [controller, fieldId, selected.frame?.id, surface],
  );
  const ref = useElementBinding(bind, forwardedRef);
  return createElement("textarea", {
    ...mergeProps(controller.getFieldProps(fieldId, surface, selected.snapshot), consumer),
    ref,
  });
});
Textarea.displayName = "Command.Textarea";

const fieldIndexes = new WeakMap<
  object,
  ReadonlyMap<string, CmdFlowViewSnapshot["fields"][number]>
>();

function indexFields(
  fields: CmdFlowViewSnapshot["fields"],
): ReadonlyMap<string, CmdFlowViewSnapshot["fields"][number]> {
  const cached = fieldIndexes.get(fields);
  if (cached) return cached;
  const index = new Map(fields.map((field) => [field.id, field]));
  fieldIndexes.set(fields, index);
  return index;
}

export const Select = forwardRef<
  HTMLSelectElement,
  ComponentPropsWithoutRef<"select"> & NamedField
>((props, forwardedRef) => {
  const { fieldId, surface: requestedSurface, ...consumer } = props;
  const surface = useSurface(requestedSurface);
  const { controller } = useCommandContext();
  const selected = useCmdFlowSelector(
    (snapshot) => ({ snapshot, frame: frameFor(snapshot, surface) }),
    undefined,
    (left, right) => left.frame === right.frame,
  );
  const bind = useCallback(
    (element: HTMLSelectElement) =>
      controller.bindField(
        fieldId,
        element,
        selected.frame?.id ? { surface, frameId: selected.frame.id } : surface,
      ),
    [controller, fieldId, selected.frame?.id, surface],
  );
  const ref = useElementBinding(bind, forwardedRef);
  const field = selected.frame ? indexFields(selected.frame.view.fields).get(fieldId) : undefined;
  const children =
    consumer.children ??
    field?.options?.map((option) =>
      createElement("option", { key: option.value, value: option.value }, option.label),
    );
  return createElement(
    "select",
    {
      ...mergeProps(controller.getFieldProps(fieldId, surface, selected.snapshot), consumer),
      multiple: consumer.multiple ?? field?.type === "multi-select",
      ref,
    },
    children,
  );
});
Select.displayName = "Command.Select";

export const FieldLabel = forwardRef<
  HTMLLabelElement,
  ComponentPropsWithoutRef<"label"> & NamedField
>((props, ref) => {
  const { fieldId, surface: requestedSurface, ...consumer } = props;
  const surface = useSurface(requestedSurface);
  const { controller } = useCommandContext();
  const selected = useCmdFlowSelector(
    (snapshot) => ({ snapshot, frame: frameFor(snapshot, surface) }),
    undefined,
    (left, right) => left.frame === right.frame,
  );
  const field = controller.getFieldProps(fieldId, surface, selected.snapshot);
  return createElement(
    "label",
    { ...consumer, htmlFor: field.id, ref },
    consumer.children ?? field["aria-label"],
  );
});
FieldLabel.displayName = "Command.FieldLabel";

export const FieldError = forwardRef<
  HTMLParagraphElement,
  ComponentPropsWithoutRef<"p"> & NamedField
>((props, ref) => {
  const { fieldId, surface: requestedSurface, ...consumer } = props;
  const surface = useSurface(requestedSurface);
  const { controller } = useCommandContext();
  const selected = useCmdFlowSelector(
    (snapshot) => {
      const frame = frameFor(snapshot, surface);
      return { snapshot, frameId: frame?.id, error: frame?.form.errors[fieldId] };
    },
    undefined,
    (left, right) => left.error === right.error && left.frameId === right.frameId,
  );
  return createElement(
    "p",
    {
      ...mergeProps(controller.getFieldErrorProps(fieldId, surface, selected.snapshot), consumer),
      ref,
      hidden: !selected.error,
    },
    consumer.children ?? selected.error,
  );
});
FieldError.displayName = "Command.FieldError";
