"use client";

import { useCmdFlow, useCmdFlowSelector } from "@cmdflow/react";
import { primaryButton } from "./styles";

export function DetailView() {
  const flow = useCmdFlow();
  const frame = useCmdFlowSelector((snapshot) => snapshot.mainFrame);
  const primaryAction = frame.actions.find((action) => action.priority === "primary");

  return (
    <article className="max-h-[min(65dvh,38rem)] overflow-y-auto overscroll-contain p-5 sm:p-6">
      <h2 className="text-pretty text-xl font-semibold tracking-tight text-foreground">
        {frame.view.title}
      </h2>
      {frame.view.description ? (
        <p className="mt-2 max-w-prose text-pretty text-sm leading-6 text-muted-foreground">
          {frame.view.description}
        </p>
      ) : null}
      {primaryAction ? (
        <button
          className={`${primaryButton} mt-6`}
          type="button"
          onClick={() => void flow.invoke({ address: { surface: "main", frameId: frame.id } })}
        >
          {primaryAction.title}
        </button>
      ) : null}
    </article>
  );
}
