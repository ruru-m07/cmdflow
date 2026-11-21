"use client";

import { type CmdFlowResolvedItem, Command, useCmdFlowSelector } from "@cmdflow/react";
import { quietButton } from "./styles";

function ActionItem({ item }: { readonly item: CmdFlowResolvedItem }) {
  const action =
    item.actions.find((candidate) => candidate.priority === "primary") ?? item.actions[0];

  return (
    <Command.Item
      item={item}
      className="group flex min-h-9 touch-manipulation select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs text-foreground data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50 data-[state=active]:bg-foreground data-[state=active]:text-canvas forced-colors:data-[state=active]:outline forced-colors:data-[state=active]:outline-1 [@media(pointer:coarse)]:min-h-11"
    >
      <span className="min-w-0 flex-1">
        <span
          className={
            action?.destructive
              ? "font-semibold underline decoration-foreground/40 underline-offset-4 group-data-[state=active]:decoration-canvas/40"
              : undefined
          }
        >
          {item.title}
        </span>
        {item.disabledReason ? (
          <small className="mt-0.5 block truncate text-[0.625rem] text-muted-foreground group-data-[state=active]:text-canvas/70">
            {item.disabledReason}
          </small>
        ) : null}
      </span>
      <Command.Shortcut className="rounded border border-border-strong bg-panel px-1.5 py-0.5 font-mono text-[0.5625rem] text-muted-foreground group-data-[state=active]:border-canvas/30 group-data-[state=active]:bg-canvas group-data-[state=active]:text-foreground" />
      {action?.hasChildren ? <span aria-hidden="true">›</span> : null}
    </Command.Item>
  );
}

export function ActionPanel() {
  const actionFrame = useCmdFlowSelector((snapshot) => snapshot.actionFrame);

  return (
    <Command.ActionPanel
      className="absolute inset-x-2 bottom-14 z-20 overflow-hidden rounded-lg border border-border-strong bg-panel-raised shadow-xl sm:right-3 sm:left-auto sm:w-[22rem]"
      aria-label="Contextual actions"
    >
      <div className="flex min-h-10 items-center gap-2 border-b border-border px-1.5 py-1 [@media(pointer:coarse)]:min-h-11">
        <Command.Back className={`${quietButton} border-transparent bg-transparent px-2`}>
          <span aria-hidden="true">←</span>
          <span className="sr-only">Back to previous actions</span>
        </Command.Back>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {actionFrame?.view.title ?? "Actions"}
        </span>
      </div>
      <Command.Input
        className="min-h-10 w-full border-0 border-b border-border bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground [@media(pointer:coarse)]:min-h-11"
        aria-label="Search actions"
        name="cmdflow-action-search"
        autoComplete="off"
        spellCheck={false}
        placeholder="Search actions…"
      />
      <Command.List className="max-h-64 overflow-y-auto overscroll-contain p-1">
        {(item) => <ActionItem key={item.candidateId} item={item} />}
      </Command.List>
      <Command.Empty className="px-4 py-8 text-center text-xs text-muted-foreground">
        No actions found
      </Command.Empty>
    </Command.ActionPanel>
  );
}
