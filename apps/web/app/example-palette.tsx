"use client";

import {
  type CmdFlowFrameSnapshot,
  type CmdFlowResolvedItem,
  Command,
  useCmdFlow,
  useCmdFlowSelector,
} from "@cmdflow/react";
import type { ReactNode } from "react";
import type { DemoContext, DemoFlow } from "./demo-flow";

export interface ExamplePaletteProps {
  readonly demo: DemoFlow;
}

const quietButton =
  "inline-flex min-h-9 touch-manipulation items-center justify-center rounded-md border border-border-strong bg-panel px-3 text-xs font-medium text-foreground transition-[transform,background-color,border-color,color] duration-100 hover:border-foreground/50 hover:bg-panel-raised active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:cursor-wait disabled:opacity-60 disabled:active:scale-100 motion-reduce:transform-none motion-reduce:transition-none [@media(pointer:coarse)]:min-h-11";

const primaryButton =
  "inline-flex min-h-9 touch-manipulation items-center justify-center rounded-md border border-foreground bg-foreground px-3 text-xs font-semibold text-canvas transition-[transform,background-color,border-color,color] duration-100 hover:bg-foreground/90 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:cursor-wait disabled:opacity-60 disabled:active:scale-100 motion-reduce:transform-none motion-reduce:transition-none [@media(pointer:coarse)]:min-h-11";

const fieldControl =
  "min-h-10 w-full rounded-md border border-border-strong bg-panel px-3 py-2 text-sm text-foreground placeholder:text-muted hover:border-foreground/50 focus-visible:border-foreground focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground aria-[invalid=true]:border-foreground aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-foreground [@media(pointer:coarse)]:min-h-11";

function ResultItem({ item }: { readonly item: CmdFlowResolvedItem }) {
  const isPullRequest = item.sourceId === "pull-requests";

  return (
    <Command.Item
      item={item}
      className="group flex min-h-10 touch-manipulation select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-foreground data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50 data-[state=active]:bg-foreground data-[state=active]:text-canvas forced-colors:data-[state=active]:outline forced-colors:data-[state=active]:outline-1 [@media(pointer:coarse)]:min-h-11"
    >
      <span
        className="grid size-7 shrink-0 place-items-center rounded border border-border-strong bg-panel text-sm text-muted group-data-[state=active]:border-canvas/30 group-data-[state=active]:bg-canvas group-data-[state=active]:text-foreground"
        aria-hidden="true"
      >
        {isPullRequest ? "↗" : "⌘"}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{item.title}</span>
        {item.subtitle ? (
          <small className="truncate text-[0.6875rem] text-muted group-data-[state=active]:text-canvas/70">
            {item.subtitle}
          </small>
        ) : null}
      </span>
      <Command.Shortcut
        shortcut="Enter"
        className="rounded border border-border-strong bg-panel px-1.5 py-0.5 font-mono text-[0.625rem] text-muted opacity-0 group-data-[state=active]:border-canvas/30 group-data-[state=active]:bg-canvas group-data-[state=active]:text-foreground group-data-[state=active]:opacity-100"
      >
        ↵
      </Command.Shortcut>
    </Command.Item>
  );
}

function SourceError({ frame }: { readonly frame: CmdFlowFrameSnapshot }) {
  const flow = useCmdFlow<DemoContext>();

  return (
    <Command.Error className="mx-3 mb-3 flex flex-wrap items-center gap-3 rounded-md border border-border-strong border-l-2 border-l-foreground bg-panel-raised p-3 text-xs text-foreground">
      {(sources) => (
        <>
          <span className="min-w-0 flex-1 break-words">
            {sources
              .map((source) => source.error)
              .filter(Boolean)
              .join(" ") || "The source could not be loaded."}
          </span>
          <button
            className={quietButton}
            type="button"
            onClick={() => flow.refresh({ surface: "main", frameId: frame.id })}
          >
            Retry Source
          </button>
        </>
      )}
    </Command.Error>
  );
}

function ListView({ demo }: ExamplePaletteProps) {
  const frame = useCmdFlowSelector((snapshot) => snapshot.mainFrame);
  const mainDepth = useCmdFlowSelector((snapshot) => snapshot.mainFrames.length);
  const source = frame.sources[0];

  return (
    <>
      <div className="relative border-b border-border">
        <span
          className="pointer-events-none absolute inset-y-0 left-4 grid place-items-center text-muted"
          aria-hidden="true"
        >
          ⌕
        </span>
        <Command.Input
          className="min-h-14 w-full border-0 bg-transparent py-3 pr-4 pl-11 text-base font-medium text-foreground placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground"
          aria-label="Search commands"
          name="cmdflow-search"
          autoComplete="off"
          spellCheck={false}
          placeholder={mainDepth > 1 ? "Search pull requests…" : "Search GitHub commands…"}
        />
      </div>

      <div
        className="flex items-center justify-between gap-4 px-3 pt-2.5 pb-1.5 font-mono text-[0.625rem] tracking-[0.12em] text-muted uppercase"
        aria-hidden="true"
      >
        <span>{source ? "Pull Requests" : "Commands"}</span>
        <span className="tabular-nums">
          {frame.items.length} Result{frame.items.length === 1 ? "" : "s"}
        </span>
      </div>

      <Command.List className="max-h-[min(45dvh,24rem)] scroll-py-1.5 overflow-y-auto overscroll-contain px-1.5 pb-1.5">
        {(item) => <ResultItem key={item.candidateId} item={item} />}
      </Command.List>

      <Command.Empty className="px-5 py-10 text-center text-sm text-muted">
        <strong className="block font-medium text-foreground">No Matches</strong>
        <span className="mt-1 block">Try a broader search.</span>
      </Command.Empty>

      <Command.Loading className="px-5 py-8 text-center text-sm text-muted">
        Loading source results…
      </Command.Loading>

      <SourceError frame={frame} />

      {source ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-[0.6875rem] text-muted">
          <span className="mr-auto">Local async source</span>
          <Command.LoadMore className={quietButton} sourceId={source.id}>
            Load More
          </Command.LoadMore>
          <button className={quietButton} type="button" onClick={demo.failNextRequest}>
            Simulate Error
          </button>
        </div>
      ) : null}
    </>
  );
}

function FormField({
  fieldId,
  children,
}: {
  readonly fieldId: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Command.FieldLabel className="block text-xs font-medium text-foreground" fieldId={fieldId} />
      {children}
      <Command.FieldError
        className="font-medium text-xs leading-5 text-foreground"
        fieldId={fieldId}
      />
    </div>
  );
}

function FormView() {
  const frame = useCmdFlowSelector((snapshot) => snapshot.mainFrame);

  return (
    <Command.Form className="max-h-[min(65dvh,38rem)] space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5">
      <header className="space-y-1.5">
        <h2 className="text-pretty text-xl font-semibold tracking-tight text-foreground">
          {frame.view.title}
        </h2>
        {frame.view.description ? (
          <p className="text-pretty text-xs leading-5 text-muted">{frame.view.description}</p>
        ) : null}
      </header>

      <FormField fieldId="title">
        <Command.Field
          className={fieldControl}
          fieldId="title"
          autoComplete="off"
          placeholder="e.g. Improve command search…"
        />
      </FormField>

      <FormField fieldId="body">
        <Command.Textarea
          className={`${fieldControl} min-h-24 resize-y`}
          fieldId="body"
          autoComplete="off"
          rows={3}
          placeholder="Add context for reviewers…"
        />
      </FormField>

      <FormField fieldId="base">
        <Command.Select
          className={`${fieldControl} bg-panel text-foreground`}
          fieldId="base"
          autoComplete="off"
        />
      </FormField>

      <Command.FieldLabel
        className="flex min-h-10 touch-manipulation cursor-pointer items-center gap-2.5 rounded-md text-xs text-foreground [@media(pointer:coarse)]:min-h-11"
        fieldId="draft"
      >
        <Command.Field
          className="size-4 shrink-0 accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          fieldId="draft"
        />
        Create as draft
      </Command.FieldLabel>

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <Command.Back className={quietButton}>Cancel</Command.Back>
        <button className={primaryButton} type="submit" disabled={frame.form.submitting}>
          {frame.form.submitting ? "Creating…" : "Create Pull Request"}
        </button>
      </div>
    </Command.Form>
  );
}

function DetailView() {
  const flow = useCmdFlow<DemoContext>();
  const frame = useCmdFlowSelector((snapshot) => snapshot.mainFrame);

  return (
    <article className="max-h-[min(65dvh,38rem)] overflow-y-auto overscroll-contain p-5 sm:p-6">
      <span
        className="mb-4 grid size-12 place-items-center rounded-lg border border-border-strong bg-panel-raised text-xl text-foreground"
        aria-hidden="true"
      >
        ↗
      </span>
      <h2 className="text-pretty text-xl font-semibold tracking-tight text-foreground">
        {frame.view.title}
      </h2>
      {frame.view.description ? (
        <p className="mt-2 max-w-prose text-pretty text-sm leading-6 text-muted">
          {frame.view.description}
        </p>
      ) : null}
      <button
        className={`${primaryButton} mt-6`}
        type="button"
        onClick={() => {
          void flow.invoke({ address: { surface: "main", frameId: frame.id } });
        }}
      >
        Mark Reviewed
      </button>
    </article>
  );
}

function UnsupportedView({ frame }: { readonly frame: CmdFlowFrameSnapshot }) {
  return (
    <div className="p-6 text-sm text-muted" role="status">
      No renderer is registered for the “{frame.view.title}” view.
    </div>
  );
}

function MainView({ demo }: ExamplePaletteProps) {
  return (
    <Command.View className="min-w-0">
      {(frame) => {
        switch (frame.view.type) {
          case "list":
            return <ListView demo={demo} />;
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
          <small className="mt-0.5 block truncate text-[0.625rem] text-muted group-data-[state=active]:text-canvas/70">
            {item.disabledReason}
          </small>
        ) : null}
      </span>
      <Command.Shortcut className="rounded border border-border-strong bg-panel px-1.5 py-0.5 font-mono text-[0.5625rem] text-muted group-data-[state=active]:border-canvas/30 group-data-[state=active]:bg-canvas group-data-[state=active]:text-foreground" />
      {action?.hasChildren ? (
        <span className="text-muted group-data-[state=active]:text-canvas" aria-hidden="true">
          ›
        </span>
      ) : null}
    </Command.Item>
  );
}

function ActionSurface() {
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
        className="min-h-10 w-full border-0 border-b border-border bg-transparent px-3 text-sm text-foreground placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground [@media(pointer:coarse)]:min-h-11"
        aria-label="Search actions"
        name="cmdflow-action-search"
        autoComplete="off"
        spellCheck={false}
        placeholder="Search actions…"
      />
      <Command.List className="max-h-64 overflow-y-auto overscroll-contain p-1">
        {(item) => <ActionItem key={item.candidateId} item={item} />}
      </Command.List>
      <Command.Empty className="px-4 py-8 text-center text-xs text-muted">
        No Actions Found
      </Command.Empty>
    </Command.ActionPanel>
  );
}

function ConfirmationSurface() {
  const confirmation = useCmdFlowSelector((snapshot) => snapshot.confirmation);
  const isDiscard = confirmation?.kind === "discard";

  return (
    <Command.Confirmation className="absolute inset-x-3 top-1/2 z-30 -translate-y-1/2 rounded-lg border border-border-strong bg-panel-raised p-5 shadow-[0_0_0_100vmax_rgb(0_0_0_/_0.8)] sm:inset-x-12">
      <h2 className="text-pretty text-lg font-semibold tracking-tight text-foreground">
        {confirmation?.title}
      </h2>
      <p className="mt-2 text-pretty text-sm leading-6 text-muted">
        {isDiscard
          ? "Your unsaved form changes will be discarded."
          : "This demo action is destructive. Confirm only if you want to continue."}
      </p>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Command.CancelConfirmation className={quietButton}>
          {isDiscard ? "Keep Editing" : "Cancel"}
        </Command.CancelConfirmation>
        <Command.Confirm className={primaryButton}>
          {isDiscard ? "Discard Changes" : "Confirm Action"}
        </Command.Confirm>
      </div>
    </Command.Confirmation>
  );
}

export function ExamplePalette({ demo }: ExamplePaletteProps) {
  const frame = useCmdFlowSelector((snapshot) => snapshot.mainFrame);
  const mainDepth = useCmdFlowSelector((snapshot) => snapshot.mainFrames.length);
  const rankingReady = useCmdFlowSelector((snapshot) => snapshot.rankingReady);
  const executionError = useCmdFlowSelector((snapshot) => {
    const execution = snapshot.executions.at(-1);
    return execution?.status === "error"
      ? (execution.error ?? "The action could not be completed.")
      : null;
  });
  const primaryAction = frame.actions.find((action) => action.priority === "primary");

  return (
    <Command.Dialog
      className="fixed inset-0 m-auto max-h-[calc(100dvh-0.75rem)] w-[calc(100vw-0.75rem)] max-w-[42.5rem] animate-none overflow-visible rounded-lg border border-border-strong bg-canvas p-0 text-left text-foreground shadow-dialog scheme-dark transition-none backdrop:animate-none backdrop:bg-black/80 backdrop:transition-none sm:max-h-[86dvh] sm:w-[calc(100vw-1.75rem)] sm:rounded-xl [&_[hidden]]:hidden"
      aria-label="CmdFlow live demo"
    >
      <header className="flex min-h-11 items-center gap-2 border-b border-border px-2 text-xs text-muted sm:px-3">
        {mainDepth > 1 ? (
          <Command.Back className={`${quietButton} border-transparent bg-transparent px-2`}>
            <span aria-hidden="true">←</span>
            <span>Back</span>
          </Command.Back>
        ) : (
          <span className="inline-flex items-center gap-2 font-medium text-foreground">
            <span className="text-foreground" aria-hidden="true">
              ⌘
            </span>
            CmdFlow
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-right text-[0.6875rem] text-muted">
          {frame.view.title}
        </span>
        <Command.Close className={`${quietButton} px-2 font-mono text-[0.625rem]`}>
          <span aria-hidden="true">Esc</span>
          <span className="sr-only">Close Command Palette</span>
        </Command.Close>
      </header>

      <MainView demo={demo} />

      {executionError ? (
        <p
          className="mx-3 mb-3 rounded-md border border-border-strong border-l-2 border-l-foreground bg-panel-raised p-3 text-xs text-foreground"
          role="alert"
        >
          {executionError}
        </p>
      ) : null}

      <footer className="flex min-h-11 items-center justify-end gap-3 rounded-b-lg border-t border-border bg-panel px-2.5 text-[0.625rem] text-muted sm:justify-between sm:rounded-b-xl sm:px-3">
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

      <ActionSurface />
      <ConfirmationSurface />
      <Command.Status />
    </Command.Dialog>
  );
}
