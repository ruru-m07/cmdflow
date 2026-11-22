"use client";

import {
  type CmdFlowViewSnapshot,
  Command,
  useCmdFlowSelector,
} from "@cmdflow/react";
import { fieldControl, primaryButton, quietButton } from "./styles";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type FormField = CmdFlowViewSnapshot["fields"][number];

function FieldControl({ field }: { readonly field: FormField }) {
  if (field.type === "textarea") {
    return (
      <Command.Textarea
        className={`${fieldControl} min-h-24 resize-y`}
        fieldId={field.id}
      />
    );
  }
  if (field.type === "select" || field.type === "multi-select") {
    return <Command.Select className={fieldControl} fieldId={field.id} />;
  }
  return <Command.Field className={fieldControl} fieldId={field.id} />;
}

function FormField({ field }: { readonly field: FormField }) {
  if (field.type === "checkbox") {
    return (
      <Command.FieldLabel
        className="flex min-h-10 touch-manipulation cursor-pointer items-center gap-2.5 rounded-md text-xs text-foreground [@media(pointer:coarse)]:min-h-11"
        fieldId={field.id}
      >
        <Command.Field
          className="size-4 shrink-0 accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          fieldId={field.id}
        />
        {field.label}
      </Command.FieldLabel>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label render={<Command.FieldLabel fieldId={field.id} />}></Label>
      <FieldControl field={field} />
      <Command.FieldError
        className="font-medium text-xs leading-5 text-foreground"
        fieldId={field.id}
      />
    </div>
  );
}

export function FormView() {
  const frame = useCmdFlowSelector((snapshot) => snapshot.mainFrame);

  return (
    <Command.Form className="max-h-[min(65dvh,38rem)] space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5">
      <header className="space-y-1.5">
        <h2 className="text-pretty text-xl font-semibold tracking-tight text-foreground">
          {frame.view.title}
        </h2>
        {frame.view.description ? (
          <p className="text-pretty text-xs leading-5 text-muted-foreground">
            {frame.view.description}
          </p>
        ) : null}
      </header>

      {frame.view.fields.map((field) => (
        <FormField key={field.id} field={field} />
      ))}

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <Command.Back className={quietButton}>Cancel</Command.Back>
        <button
          className={primaryButton}
          type="submit"
          disabled={frame.form.submitting}
        >
          {frame.form.submitting
            ? "Submitting…"
            : (frame.view.submit?.title ?? "Submit")}
        </button>
      </div>
    </Command.Form>
  );
}
