"use client";

import {
  type CmdFlowFrameSnapshot,
  type CmdFlowResolvedItem,
  Command,
  useCmdFlow,
  useCmdFlowSelector,
} from "@cmdflow/react";
import type { ReactNode } from "react";
import { ResultItem } from "./result-item";
import { quietButton } from "./styles";

interface ItemSection<TData> {
  readonly key: string;
  readonly label: string;
  readonly items: readonly CmdFlowResolvedItem<TData>[];
}

interface MutableItemSection<TData> extends Omit<ItemSection<TData>, "items"> {
  readonly items: CmdFlowResolvedItem<TData>[];
}

export interface ListViewContext<TData> {
  readonly frame: CmdFlowFrameSnapshot<TData>;
  readonly activeItem: CmdFlowResolvedItem<TData> | null;
}

export interface ListViewProps<TData> {
  readonly renderAnnotation?: (context: ListViewContext<TData>) => ReactNode;
  readonly renderItemIcon?: (item: CmdFlowResolvedItem<TData>) => ReactNode;
  readonly renderItemAccessory?: (item: CmdFlowResolvedItem<TData>) => ReactNode;
}

function groupItems<TData>(frame: CmdFlowFrameSnapshot<TData>): readonly ItemSection<TData>[] {
  const groups: MutableItemSection<TData>[] = [];
  for (const item of frame.items) {
    const key = item.section ?? "";
    const current = groups.at(-1);
    if (current?.key === key) {
      current.items.push(item);
      continue;
    }
    groups.push({ key, label: key || frame.view.title, items: [item] });
  }
  return groups;
}

function SourceErrors<TData>({ frame }: { readonly frame: CmdFlowFrameSnapshot<TData> }) {
  const flow = useCmdFlow();
  const errors = frame.sources.flatMap((source) => (source.error ? [source.error] : []));
  if (errors.length === 0) return null;

  return (
    <div
      className="mx-3 mb-3 flex flex-wrap items-center gap-3 rounded-md border border-border-strong border-l-2 border-l-foreground bg-panel-raised p-3 text-xs text-foreground"
      role="alert"
    >
      <span className="min-w-0 flex-1 break-words">{errors.join(" ")}</span>
      <button
        className={quietButton}
        type="button"
        onClick={() => flow.refresh({ surface: "main", frameId: frame.id })}
      >
        Retry
      </button>
    </div>
  );
}

export function ListView<TData>({
  renderAnnotation,
  renderItemIcon,
  renderItemAccessory,
}: ListViewProps<TData>) {
  const frame = useCmdFlowSelector<CmdFlowFrameSnapshot<TData>, unknown, TData>(
    (snapshot) => snapshot.mainFrame,
  );
  const depth = useCmdFlowSelector((snapshot) => snapshot.mainFrames.length);
  const sections = groupItems(frame);
  const activeItem = frame.items.find((item) => item.candidateId === frame.activeId) ?? null;
  const annotation = renderAnnotation?.({ frame, activeItem });

  return (
    <>
      <div className="relative flex items-center border-b border-border">
        {depth > 1 ? (
          <Command.Back
            className={`${quietButton} ml-2 shrink-0 border-transparent bg-transparent px-2`}
          >
            <span aria-hidden="true">←</span>
            <span className="sr-only">Back</span>
          </Command.Back>
        ) : null}
        <Command.Input
          className="min-h-14 min-w-0 flex-1 border-0 bg-transparent px-3 py-3 text-base font-medium text-foreground placeholder:text-muted-foreground focus-visible:outline-0 focus-visible:-outline-offset-2 focus-visible:outline-foreground"
          aria-label={`Search ${frame.view.title}`}
          name="cmdflow-search"
          autoComplete="off"
          spellCheck={false}
          placeholder={depth > 1 ? `Search ${frame.view.title.toLowerCase()}…` : "Search commands…"}
        />
      </div>

      {annotation}

      <Command.List className="max-h-[min(45dvh,24rem)] scroll-py-1.5 overflow-y-auto overscroll-contain px-1.5 pb-1.5">
        {sections.map((section) => (
          <Command.Group
            key={section.items[0]?.candidateId ?? section.key}
            label={section.key}
            forceMount
          >
            <div className="flex h-8 items-center justify-between gap-4 px-1.5 font-mono text-[0.625rem] tracking-[0.12em] text-muted-foreground uppercase">
              <span>{section.label}</span>
              <span className="tabular-nums">
                {section.items.length} Result{section.items.length === 1 ? "" : "s"}
              </span>
            </div>
            {section.items.map((item) => (
              <ResultItem
                key={item.candidateId}
                item={item}
                first={item.candidateId === frame.items[0]?.candidateId}
                renderIcon={renderItemIcon}
                renderAccessory={renderItemAccessory}
              />
            ))}
          </Command.Group>
        ))}
      </Command.List>

      <Command.Empty className="px-5 py-10 text-center text-sm text-muted-foreground">
        <strong className="block font-medium text-foreground">No Matches</strong>
        <span className="mt-1 block">Try a broader search.</span>
      </Command.Empty>

      <Command.Loading className="px-5 py-8 text-center text-sm text-muted-foreground">
        Loading results…
      </Command.Loading>

      <SourceErrors frame={frame} />

      {frame.sources.length > 0 ? (
        <div className="flex items-center justify-end border-t border-border px-3 py-2">
          <Command.LoadMore className={quietButton}>Load More</Command.LoadMore>
        </div>
      ) : null}
    </>
  );
}
