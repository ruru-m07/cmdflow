"use client";

import type {
  CandidateId,
  CmdFlow,
  CmdFlowFrameSnapshot,
  CmdFlowResolvedItem,
  CmdFlowSnapshot,
  CmdFlowSurface,
} from "@cmdflow/core";
import { useCallback, useContext, useMemo, useRef, useSyncExternalStore } from "react";

import { CommandContext, type CommandContextValue, SurfaceContext } from "./context.js";

export function useCommandContext(): CommandContextValue {
  const context = useContext(CommandContext);
  if (!context) throw new Error("CmdFlow primitives must be inside Command.Root.");
  return context;
}

export function useCmdFlow<TContext = unknown, TData = unknown>(): CmdFlow<TContext, TData> {
  return useCommandContext().flow as CmdFlow<TContext, TData>;
}

interface LegacyCmdflowSnapshot<TData> extends CmdFlowSnapshot<TData> {
  readonly current: CmdFlowFrameSnapshot<TData>;
  readonly main: readonly CmdFlowFrameSnapshot<TData>[];
}

interface LegacyCmdflowBinding<TContext, TData> {
  readonly store: CmdFlow<TContext, TData>;
  readonly snapshot: LegacyCmdflowSnapshot<TData>;
}

/** @deprecated Use `useCmdFlow()` and `useCmdFlowSelector()` instead. */
export function useCmdflow<TContext = unknown, TData = unknown>(): LegacyCmdflowBinding<
  TContext,
  TData
> {
  const store = useCmdFlow<TContext, TData>();
  const snapshot = useCmdFlowSelector<CmdFlowSnapshot<TData>, TContext, TData>((value) => value);
  return useMemo(
    () => ({
      store,
      snapshot: Object.freeze({
        ...snapshot,
        current: snapshot.mainFrame,
        main: snapshot.mainFrames,
      }),
    }),
    [snapshot, store],
  );
}

export function useCmdFlowSelector<Selected, TContext = unknown, TData = unknown>(
  selector: (snapshot: CmdFlowSnapshot<TData>) => Selected,
  suppliedFlow?: CmdFlow<TContext, TData>,
  equal: (left: Selected, right: Selected) => boolean = Object.is,
): Selected {
  const context = useContext(CommandContext);
  const flow = suppliedFlow ?? (context?.flow as CmdFlow<TContext, TData> | undefined);
  if (!flow) throw new Error("Supply a CmdFlow instance or render inside Command.Root.");

  const selectorRef = useRef(selector);
  const equalRef = useRef(equal);
  selectorRef.current = selector;
  equalRef.current = equal;

  const cache = useMemo(() => {
    let initialized = false;
    let previousSnapshot: CmdFlowSnapshot<TData>;
    let previousSelector: typeof selector;
    let previous: Selected;
    const select = (snapshot: CmdFlowSnapshot<TData>): Selected => {
      const currentSelector = selectorRef.current;
      if (initialized && previousSnapshot === snapshot && previousSelector === currentSelector)
        return previous;
      const next = currentSelector(snapshot);
      previousSnapshot = snapshot;
      previousSelector = currentSelector;
      if (!initialized || !equalRef.current(previous, next)) previous = next;
      initialized = true;
      return previous;
    };
    return {
      client: () => select(flow.getSnapshot()),
      server: () => select(flow.getServerSnapshot()),
    };
  }, [flow]);
  const subscribe = useCallback((listener: () => void) => flow.subscribe(listener), [flow]);
  return useSyncExternalStore(subscribe, cache.client, cache.server);
}

export function frameFor<TData>(
  snapshot: CmdFlowSnapshot<TData>,
  surface: CmdFlowSurface,
): CmdFlowFrameSnapshot<TData> | null {
  return surface === "actions" ? snapshot.actionFrame : snapshot.mainFrame;
}

export function useSurface(surface?: CmdFlowSurface): CmdFlowSurface {
  const inheritedSurface = useContext(SurfaceContext);
  return surface ?? inheritedSurface;
}

export function useCommandFrame<TData = unknown>(
  surface?: CmdFlowSurface,
): CmdFlowFrameSnapshot<TData> | null {
  const resolvedSurface = useSurface(surface);
  return useCmdFlowSelector<CmdFlowFrameSnapshot<TData> | null, unknown, TData>((snapshot) =>
    frameFor(snapshot, resolvedSurface),
  );
}

export interface ItemLookup<TData = unknown> {
  readonly item: CmdFlowResolvedItem<TData>;
  readonly index: number;
}

const itemIndexes = new WeakMap<object, ReadonlyMap<CandidateId, ItemLookup<unknown>>>();

export function indexItems<TData>(
  items: readonly CmdFlowResolvedItem<TData>[],
): ReadonlyMap<CandidateId, ItemLookup<TData>> {
  const cached = itemIndexes.get(items);
  if (cached) return cached as ReadonlyMap<CandidateId, ItemLookup<TData>>;
  const index = new Map<CandidateId, ItemLookup<TData>>();
  for (const [position, item] of items.entries())
    index.set(item.candidateId, { item, index: position });
  itemIndexes.set(items, index as ReadonlyMap<CandidateId, ItemLookup<unknown>>);
  return index;
}
