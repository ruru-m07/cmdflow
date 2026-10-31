import type { CmdFlowFormFieldSnapshot, CmdFlowSelectOption } from "@cmdflow/core";
import { type Accessor, createMemo, For, type JSX, splitProps, useContext } from "solid-js";

import { createBoundProps, renderElement } from "../bindings.js";
import { SurfaceContext, useCommandContext } from "../context.js";
import type { ElementProps } from "../merge-props.js";
import { createAddress, frameFor } from "../selectors.js";
import type { SurfaceProps } from "./shared.js";

function surfaceAccessor(
  requested: Accessor<SurfaceProps["surface"]>,
): Accessor<"main" | "actions"> {
  const inherited = useContext(SurfaceContext);
  return () => requested() ?? inherited;
}

export function Form(props: JSX.FormHTMLAttributes<HTMLFormElement> & SurfaceProps): JSX.Element {
  const [local, consumer] = splitProps(props, ["surface"]);
  const surface = surfaceAccessor(() => local.surface);
  const { controller, snapshot } = useCommandContext();
  const address = createAddress(surface);
  return renderElement(
    "form",
    createBoundProps<HTMLFormElement>(
      () => ({
        noValidate: true,
        ...(controller.getFormProps(surface(), snapshot()) as unknown as ElementProps),
      }),
      consumer,
      (element) => controller.bindForm(element, address()),
    ),
  );
}

export type FieldProps = JSX.InputHTMLAttributes<HTMLInputElement> &
  SurfaceProps & { readonly fieldId: string };

export function createFieldProps(props: FieldProps): JSX.InputHTMLAttributes<HTMLInputElement> {
  const [local, consumer] = splitProps(props, ["surface", "fieldId"]);
  const surface = surfaceAccessor(() => local.surface);
  const { controller, snapshot } = useCommandContext();
  const address = createAddress(surface);
  return createBoundProps<HTMLInputElement>(
    () => controller.getFieldProps(local.fieldId, surface(), snapshot()) as unknown as ElementProps,
    consumer,
    (element) => controller.bindField(local.fieldId, element, address()),
  ) as JSX.InputHTMLAttributes<HTMLInputElement>;
}

export function Field(props: FieldProps): JSX.Element {
  return renderElement("input", createFieldProps(props) as ElementProps);
}

type NamedField = SurfaceProps & { readonly fieldId: string };

const fieldIndexes = new WeakMap<object, ReadonlyMap<string, CmdFlowFormFieldSnapshot>>();

function indexFields(
  fields: readonly CmdFlowFormFieldSnapshot[],
): ReadonlyMap<string, CmdFlowFormFieldSnapshot> {
  const cached = fieldIndexes.get(fields);
  if (cached) return cached;
  const index = new Map(fields.map((field) => [field.id, field]));
  fieldIndexes.set(fields, index);
  return index;
}

export function Textarea(
  props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement> & NamedField,
): JSX.Element {
  const [local, consumer] = splitProps(props, ["surface", "fieldId"]);
  const surface = surfaceAccessor(() => local.surface);
  const { controller, snapshot } = useCommandContext();
  const address = createAddress(surface);
  return renderElement(
    "textarea",
    createBoundProps<HTMLTextAreaElement>(
      () =>
        controller.getFieldProps(local.fieldId, surface(), snapshot()) as unknown as ElementProps,
      consumer,
      (element) => controller.bindField(local.fieldId, element, address()),
    ),
  );
}

export function Select(
  props: JSX.SelectHTMLAttributes<HTMLSelectElement> & NamedField,
): JSX.Element {
  const [local, consumer] = splitProps(props, ["surface", "fieldId"]);
  const surface = surfaceAccessor(() => local.surface);
  const { controller, snapshot } = useCommandContext();
  const address = createAddress(surface);
  const field = createMemo(() => {
    const frame = frameFor(snapshot(), surface());
    return frame ? indexFields(frame.view.fields).get(local.fieldId) : undefined;
  });
  const options = createMemo(() => field()?.options ?? []);
  const generatedOptions = For<readonly CmdFlowSelectOption[], JSX.Element>({
    get each() {
      return options();
    },
    children: (option) => renderElement("option", { value: option.value, children: option.label }),
  });

  return renderElement(
    "select",
    createBoundProps<HTMLSelectElement>(
      () => ({
        ...(controller.getFieldProps(
          local.fieldId,
          surface(),
          snapshot(),
        ) as unknown as ElementProps),
        multiple: consumer.multiple ?? field()?.type === "multi-select",
        children: generatedOptions,
      }),
      consumer,
      (element) => controller.bindField(local.fieldId, element, address()),
    ),
  );
}

export function FieldLabel(
  props: JSX.LabelHTMLAttributes<HTMLLabelElement> & NamedField,
): JSX.Element {
  const [local, consumer] = splitProps(props, ["surface", "fieldId"]);
  const surface = surfaceAccessor(() => local.surface);
  const { controller, snapshot } = useCommandContext();
  return renderElement(
    "label",
    createBoundProps<HTMLLabelElement>(() => {
      const field = controller.getFieldProps(local.fieldId, surface(), snapshot());
      return { for: field.id, children: field["aria-label"] };
    }, consumer),
  );
}

export function FieldError(
  props: JSX.HTMLAttributes<HTMLParagraphElement> & NamedField,
): JSX.Element {
  const [local, consumer] = splitProps(props, ["surface", "fieldId"]);
  const surface = surfaceAccessor(() => local.surface);
  const { controller, snapshot } = useCommandContext();
  return renderElement(
    "p",
    createBoundProps<HTMLParagraphElement>(() => {
      const error = frameFor(snapshot(), surface())?.form.errors[local.fieldId];
      return {
        ...(controller.getFieldErrorProps(
          local.fieldId,
          surface(),
          snapshot(),
        ) as unknown as ElementProps),
        children: error,
        hidden: !error,
      };
    }, consumer),
  );
}
