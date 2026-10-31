import type {
  CandidateId,
  CmdFlow,
  CmdFlowFrameSnapshot,
  CmdFlowResolvedItem,
  CmdFlowSnapshot,
  CmdFlowSurface,
  CmdFlowSurfaceAddress,
} from "@cmdflow/core";
import { type Accessor, createMemo, createSignal, onCleanup, onMount, useContext } from "solid-js";
import { isServer } from "solid-js/web";

import { CommandContext, SurfaceContext, useCommandContext } from "./context.js";

export function useCmdFlow<TContext = unknown, TData = unknown>(): CmdFlow<TContext, TData> {
  return useCommandContext().flow as CmdFlow<TContext, TData>;
}

function createExternalSnapshot<TData>(
  flow: CmdFlow<unknown, TData>,
): Accessor<CmdFlowSnapshot<TData>> {
  const [snapshot, setSnapshot] = createSignal(
    isServer ? flow.getServerSnapshot() : flow.getSnapshot(),
  );

  onMount(() => {
    const update = (): void => {
      setSnapshot(() => flow.getSnapshot());
    };
    const unsubscribe = flow.subscribe(update);
    update();
    onCleanup(unsubscribe);
  });

  return snapshot;
}

export function createCmdFlowSelector<Selected, TContext = unknown, TData = unknown>(
  selector: (snapshot: CmdFlowSnapshot<TData>) => Selected,
  suppliedFlow?: CmdFlow<TContext, TData>,
  equal: (left: Selected, right: Selected) => boolean = Object.is,
): Accessor<Selected> {
  const context = useContext(CommandContext);
  const flow = suppliedFlow ?? (context?.flow as CmdFlow<TContext, TData> | undefined);
  if (!flow) throw new Error("Supply a CmdFlow instance or render inside Command.Root.");

  const snapshot =
    context && context.flow === flow
      ? (context.snapshot as Accessor<CmdFlowSnapshot<TData>>)
      : createExternalSnapshot(flow as CmdFlow<unknown, TData>);

  return createMemo(() => selector(snapshot()), undefined, { equals: equal });
}

export function frameFor<TData>(
  snapshot: CmdFlowSnapshot<TData>,
  surface: CmdFlowSurface,
): CmdFlowFrameSnapshot<TData> | null {
  return surface === "actions" ? snapshot.actionFrame : snapshot.mainFrame;
}

export function useSurface(surface?: CmdFlowSurface): CmdFlowSurface {
  return surface ?? useContext(SurfaceContext);
}

export function createCommandFrame<TData = unknown>(
  surface?: CmdFlowSurface,
): Accessor<CmdFlowFrameSnapshot<TData> | null> {
  const inheritedSurface = useContext(SurfaceContext);
  return createCmdFlowSelector<CmdFlowFrameSnapshot<TData> | null, unknown, TData>((snapshot) =>
    frameFor(snapshot, surface ?? inheritedSurface),
  );
}

export function createAddress(surface: Accessor<CmdFlowSurface>): Accessor<CmdFlowSurfaceAddress> {
  const { snapshot } = useCommandContext();
  return createMemo(
    () => ({
      surface: surface(),
      frameId: frameFor(snapshot(), surface())?.id ?? "absent",
    }),
    undefined,
    {
      equals: (left, right) => left.surface === right.surface && left.frameId === right.frameId,
    },
  );
}

export interface ItemLookup<TData = unknown> {
  readonly item: CmdFlowResolvedItem<TData>;
  readonly index: number;
}

export interface ItemCollectionIndex<TData = unknown> {
  readonly byId: ReadonlyMap<CandidateId, ItemLookup<TData>>;
  readonly groupCounts: Readonly<Record<string, number>>;
}

const itemIndexes = new WeakMap<object, ItemCollectionIndex<unknown>>();

/** Build exactly one item lookup Map for each immutable frame item collection. */
export function indexItems<TData>(
  items: readonly CmdFlowResolvedItem<TData>[],
): ItemCollectionIndex<TData> {
  const cached = itemIndexes.get(items);
  if (cached) return cached as ItemCollectionIndex<TData>;

  const byId = new Map<CandidateId, ItemLookup<TData>>();
  const groupCounts: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const [position, item] of items.entries()) {
    byId.set(item.candidateId, { item, index: position });
    const group = item.section ?? "";
    groupCounts[group] = (groupCounts[group] ?? 0) + 1;
  }

  const index: ItemCollectionIndex<TData> = {
    byId,
    groupCounts: Object.freeze(groupCounts),
  };
  itemIndexes.set(items, index as ItemCollectionIndex<unknown>);
  return index;
}
