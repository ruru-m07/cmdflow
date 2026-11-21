"use client";

import {
  type CmdFlowActionSnapshot,
  type CmdFlowFrameSnapshot,
  type CmdFlowResolvedItem,
  Command,
  useCmdFlowSelector,
} from "@cmdflow/react";
import type { ReactNode } from "react";
import { ActionPanel } from "./action-panel";
import { Confirmation } from "./confirmation";
import { DetailView } from "./detail-view";
import { FormView } from "./form-view";
import { ListView, type ListViewContext } from "./list-view";

export interface PaletteFooterContext<TData> extends ListViewContext<TData> {
  readonly primaryAction: CmdFlowActionSnapshot | undefined;
  readonly rankingReady: boolean;
}

export interface CommandPaletteProps<TData = unknown> {
  readonly renderListAnnotation?: (context: ListViewContext<TData>) => ReactNode;
  readonly renderItemIcon?: (item: CmdFlowResolvedItem<TData>) => ReactNode;
  readonly renderItemAccessory?: (item: CmdFlowResolvedItem<TData>) => ReactNode;
  readonly renderFooter?: (context: PaletteFooterContext<TData>) => ReactNode;
}

function UnsupportedView({ frame }: { readonly frame: CmdFlowFrameSnapshot }) {
  return (
    <div className="p-6 text-sm text-muted-foreground" role="status">
      No renderer is registered for the “{frame.view.title}” view.
    </div>
  );
}

function ActiveView<TData>({
  renderListAnnotation,
  renderItemIcon,
  renderItemAccessory,
}: CommandPaletteProps<TData>) {
  return (
    <Command.View className="min-w-0">
      {(frame) => {
        switch (frame.view.type) {
          case "list":
            return (
              <ListView
                renderAnnotation={renderListAnnotation}
                renderItemIcon={renderItemIcon}
                renderItemAccessory={renderItemAccessory}
              />
            );
          case "form":
            return <FormView />;
          case "detail":
            return <DetailView />;
          default:
            return <UnsupportedView frame={frame} />;
        }
      }}
    </Command.View>
  );
}

function DefaultFooter({
  primaryAction,
  rankingReady,
}: Pick<PaletteFooterContext<unknown>, "primaryAction" | "rankingReady">) {
  return (
    <footer className="flex min-h-11 items-center justify-end gap-3 rounded-b-lg border-t border-border bg-panel px-2.5 text-[0.625rem] text-muted-foreground sm:justify-between sm:px-3">
      <span className="hidden sm:inline">
        {rankingReady ? "Preferences stay local" : "Loading preferences…"}
      </span>
      <div className="flex min-w-0 items-center gap-2">
        <span className="max-w-32 truncate text-foreground">
          {primaryAction?.title ?? "Navigate"}
        </span>
        <kbd className="rounded border border-border-strong bg-panel px-1.5 py-0.5 font-mono text-[0.5625rem] text-foreground">
          ↵
        </kbd>
        <Command.Separator className="mx-1 h-4 border-l border-border-strong" />
        <Command.ActionPanelTrigger className="inline-flex min-h-9 touch-manipulation items-center gap-2 rounded-md px-2 text-foreground transition-[transform,background-color,color] duration-100 hover:bg-panel-raised active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground motion-reduce:transform-none motion-reduce:transition-none [@media(pointer:coarse)]:min-h-11">
          Actions
          <kbd className="rounded border border-border-strong bg-panel px-1.5 py-0.5 font-mono text-[0.5625rem] text-foreground [@media(pointer:coarse)]:hidden">
            ⌘&nbsp;K
          </kbd>
        </Command.ActionPanelTrigger>
      </div>
    </footer>
  );
}

export function CommandPalette<TData = unknown>({
  renderListAnnotation,
  renderItemIcon,
  renderItemAccessory,
  renderFooter,
}: CommandPaletteProps<TData>) {
  const frame = useCmdFlowSelector<CmdFlowFrameSnapshot<TData>, unknown, TData>(
    (snapshot) => snapshot.mainFrame,
  );
  const rankingReady = useCmdFlowSelector((snapshot) => snapshot.rankingReady);
  const executionError = useCmdFlowSelector((snapshot) => {
    const execution = snapshot.executions.at(-1);
    return execution?.status === "error"
      ? (execution.error ?? "The action could not be completed.")
      : null;
  });
  const primaryAction = frame.actions.find((action) => action.priority === "primary");
  const activeItem = frame.items.find((item) => item.candidateId === frame.activeId) ?? null;
  const footer = renderFooter?.({ frame, activeItem, primaryAction, rankingReady });

  return (
    <Command.Dialog
      className="fixed top-3 left-1/2 m-0 max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-0.75rem)] max-w-[42.5rem] -translate-x-1/2 animate-none overflow-visible rounded-lg border border-border bg-canvas p-0 text-left text-foreground shadow-dialog transition-none backdrop:animate-none backdrop:bg-black/80 backdrop:transition-none sm:top-[10dvh] sm:max-h-[80dvh] sm:w-[calc(100vw-1.75rem)] [&_[hidden]]:hidden"
      aria-label="Command palette"
    >
      <ActiveView
        renderListAnnotation={renderListAnnotation}
        renderItemIcon={renderItemIcon}
        renderItemAccessory={renderItemAccessory}
      />

      {executionError ? (
        <p
          className="mx-3 mb-3 rounded-md border border-border-strong border-l-2 border-l-foreground bg-panel-raised p-3 text-xs text-foreground"
          role="alert"
        >
          {executionError}
        </p>
      ) : null}

      {footer ?? <DefaultFooter primaryAction={primaryAction} rankingReady={rankingReady} />}

      <ActionPanel />
      <Confirmation />
      <Command.Status className="sr-only" />
    </Command.Dialog>
  );
}
