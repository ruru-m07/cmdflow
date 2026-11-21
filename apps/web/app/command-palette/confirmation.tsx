"use client";

import { Command, useCmdFlowSelector } from "@cmdflow/react";
import { primaryButton, quietButton } from "./styles";

export function Confirmation() {
  const confirmation = useCmdFlowSelector((snapshot) => snapshot.confirmation);
  const isDiscard = confirmation?.kind === "discard";

  return (
    <Command.Confirmation className="absolute inset-x-3 top-1/2 z-30 -translate-y-1/2 rounded-lg border border-border-strong bg-panel-raised p-5 shadow-[0_0_0_100vmax_rgb(0_0_0_/_0.8)] sm:inset-x-12">
      <h2 className="text-pretty text-lg font-semibold tracking-tight text-foreground">
        {confirmation?.title}
      </h2>
      <p className="mt-2 text-pretty text-sm leading-6 text-muted-foreground">
        {isDiscard
          ? "Your unsaved form changes will be discarded."
          : "This action cannot be undone. Confirm only if you want to continue."}
      </p>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Command.CancelConfirmation className={quietButton}>
          {isDiscard ? "Keep editing" : "Cancel"}
        </Command.CancelConfirmation>
        <Command.Confirm className={primaryButton}>
          {isDiscard ? "Discard changes" : "Confirm action"}
        </Command.Confirm>
      </div>
    </Command.Confirmation>
  );
}
