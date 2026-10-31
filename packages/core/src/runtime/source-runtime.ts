import type {
  CmdFlowCommandDefinition,
  CmdFlowResultBatch,
  CmdFlowResultSource,
} from "../contracts/definitions.js";
import type { CmdFlowDomEffect } from "../contracts/flow.js";
import { normalizeQueryV1, QUERY_NORMALIZATION_VERSION } from "../ranking.js";
import type { RankingScope } from "../ranking-types.js";
import { normalizeCommandDefinition } from "./definitions.js";
import type { Frame, SourceState } from "./state.js";
import { abortable, errorMessage } from "./utils.js";

export interface SourceRuntimeDependencies<TContext, TData> {
  readonly getContext: () => TContext;
  readonly getOpened: () => boolean;
  readonly getSession: () => number;
  readonly getSources: () => ReadonlyMap<string, CmdFlowResultSource<TContext, TData>>;
  readonly isFrameAlive: (frame: Frame<TContext, TData>) => boolean;
  readonly isRootFrame: (frame: Frame<TContext, TData>) => boolean;
  readonly getScope: (frame: Frame<TContext, TData>) => RankingScope;
  readonly publish: () => void;
  readonly diagnostic: (type: string, id?: string, detail?: string) => void;
  readonly effect: (
    type: CmdFlowDomEffect["type"],
    extras?: Omit<CmdFlowDomEffect, "id" | "revision" | "type">,
  ) => void;
}

export interface SourceRuntime<TContext, TData> {
  abort(state: SourceState<TContext, TData>): void;
  sync(frame: Frame<TContext, TData>): void;
  start(frame: Frame<TContext, TData>, clear?: boolean): void;
  loadMore(
    frame: Frame<TContext, TData>,
    state: SourceState<TContext, TData>,
    cursor: string,
  ): Promise<void>;
}

export function createSourceRuntime<TContext, TData>(
  dependencies: SourceRuntimeDependencies<TContext, TData>,
): SourceRuntime<TContext, TData> {
  function closeIterator(
    iterator: AsyncIterator<CmdFlowResultBatch<TContext, TData>> | undefined,
    sourceId: string,
  ): void {
    if (!iterator?.return) return;
    try {
      void Promise.resolve(iterator.return()).catch((error) =>
        dependencies.diagnostic("source-cleanup-error", sourceId, errorMessage(error)),
      );
    } catch (error) {
      dependencies.diagnostic("source-cleanup-error", sourceId, errorMessage(error));
    }
  }

  function abort(state: SourceState<TContext, TData>): void {
    const controller = state.controller;
    const timer = state.timer;
    const iterator = state.iterator;
    state.iterator = undefined;
    state.controller = undefined;
    state.timer = undefined;
    if (timer) clearTimeout(timer);
    controller?.abort();
    closeIterator(iterator, state.definition.id);
  }

  function definitions(
    frame: Frame<TContext, TData>,
  ): readonly CmdFlowResultSource<TContext, TData>[] {
    if (frame.definition.type !== "list") return [];
    const sourceIds = frame.definition.sourceIds;
    if (sourceIds) {
      return sourceIds.flatMap((sourceId) => {
        const source = dependencies.getSources().get(sourceId);
        return source ? [source] : [];
      });
    }
    return dependencies.isRootFrame(frame) ? [...dependencies.getSources().values()] : [];
  }

  function sync(frame: Frame<TContext, TData>): void {
    const nextDefinitions = definitions(frame);
    for (const [sourceId, state] of frame.sources) {
      if (
        !nextDefinitions.some((source) => source.id === sourceId && source === state.definition)
      ) {
        abort(state);
        frame.sources.delete(sourceId);
      }
    }
    for (const definition of nextDefinitions) {
      if (!frame.sources.has(definition.id)) {
        frame.sources.set(definition.id, {
          definition,
          items: new Map(),
          pageId: 0,
          snapshot: { id: definition.id, status: "idle", searchEpoch: 0 },
        });
      }
    }
  }

  async function run(
    frame: Frame<TContext, TData>,
    state: SourceState<TContext, TData>,
    cursor?: string,
  ): Promise<void> {
    const controller = new AbortController();
    state.controller = controller;
    const epoch = state.snapshot.searchEpoch;
    const pageId = ++state.pageId;
    const openSession = dependencies.getSession();
    const valid = () =>
      dependencies.getOpened() &&
      openSession === dependencies.getSession() &&
      dependencies.isFrameAlive(frame) &&
      frame.sources.get(state.definition.id) === state &&
      state.snapshot.searchEpoch === epoch &&
      state.pageId === pageId &&
      !controller.signal.aborted;
    state.snapshot = { id: state.definition.id, status: "loading", searchEpoch: epoch };
    dependencies.publish();
    dependencies.diagnostic("source-start", state.definition.id);
    let done = false;

    const applyBatch = (batch: CmdFlowResultBatch<TContext, TData>) => {
      if (!valid()) return;
      if (done) {
        dependencies.diagnostic("source-after-complete", state.definition.id);
        return;
      }
      if (cursor && batch.operation === "replace") {
        throw new Error("Paginated CmdFlow sources must emit patch batches");
      }
      let nextItems =
        batch.operation === "replace"
          ? new Map<string, CmdFlowCommandDefinition<TContext, TData>>()
          : new Map(state.items);
      if (batch.operation === "patch") {
        for (const itemId of batch.remove ?? []) nextItems.delete(itemId);
      }
      const batchIds = new Set<string>();
      for (const [index, item] of batch.items.entries()) {
        if (batchIds.has(item.id)) {
          dependencies.diagnostic("duplicate-source-item", item.id);
        }
        if (!valid()) return;
        batchIds.add(item.id);
        nextItems.set(
          item.id,
          normalizeCommandDefinition(item, `source:${state.definition.id}.items[${index}]`),
        );
      }
      if (state.definition.limit !== undefined) {
        const sorted = [...nextItems].sort(
          ([leftId, left], [rightId, right]) =>
            (left.providerRank ?? 0) - (right.providerRank ?? 0) ||
            (leftId < rightId ? -1 : leftId > rightId ? 1 : 0),
        );
        nextItems = new Map(sorted.slice(0, Math.max(0, state.definition.limit)));
      }
      if (!valid()) return;
      state.items = nextItems;
      done = batch.done;
      state.snapshot = {
        id: state.definition.id,
        status: done ? "success" : "loading",
        searchEpoch: epoch,
        ...(done && batch.nextCursor ? { nextCursor: batch.nextCursor } : {}),
      };
      dependencies.effect("scroll", { frameId: frame.id });
      if (done) {
        dependencies.effect("announce", {
          message: `${state.items.size} results from ${state.definition.id}`,
        });
      }
      dependencies.publish();
      dependencies.diagnostic("source-batch", state.definition.id);
    };

    try {
      if (!valid()) return;
      const query = frame.query;
      const result = state.definition.search({
        rawQuery:
          state.definition.remoteQuery === "normalized" || state.definition.remoteQuery === "none"
            ? ""
            : query,
        normalizedQuery: state.definition.remoteQuery === "none" ? "" : normalizeQueryV1(query),
        normalizationVersion: QUERY_NORMALIZATION_VERSION,
        context: dependencies.getContext(),
        scope: dependencies.getScope(frame),
        cursor,
        signal: controller.signal,
      });
      if (result && typeof result === "object" && Symbol.asyncIterator in result) {
        const iterator = result[Symbol.asyncIterator]();
        state.iterator = iterator;
        while (valid()) {
          const next = await abortable(iterator.next(), controller.signal);
          if (!valid()) break;
          if (next.done) {
            if (!done) {
              dependencies.diagnostic("source-missing-final", state.definition.id);
              applyBatch({ operation: "patch", items: [], done: true });
            }
            break;
          }
          applyBatch(next.value);
          if (done) {
            if (state.iterator === iterator) {
              state.iterator = undefined;
              closeIterator(iterator, state.definition.id);
            }
            break;
          }
        }
      } else {
        const batch = await abortable(result, controller.signal);
        if (!batch.done) {
          throw new Error("A synchronous or Promise source must return a final batch");
        }
        applyBatch(batch);
      }
      if (valid()) dependencies.diagnostic("source-success", state.definition.id);
    } catch (error) {
      if (valid()) {
        state.snapshot = {
          id: state.definition.id,
          status: "error",
          error: errorMessage(error),
          searchEpoch: epoch,
          ...(cursor ? { nextCursor: cursor } : {}),
        };
        dependencies.effect("announce", {
          message: `Could not load ${state.definition.id}`,
        });
        dependencies.publish();
        dependencies.diagnostic("source-error", state.definition.id, errorMessage(error));
      } else {
        dependencies.diagnostic("source-abort", state.definition.id);
      }
    } finally {
      if (state.controller === controller) {
        const iterator = state.iterator;
        state.controller = undefined;
        state.iterator = undefined;
        closeIterator(iterator, state.definition.id);
      }
    }
  }

  function start(frame: Frame<TContext, TData>, clear = true): void {
    sync(frame);
    for (const state of frame.sources.values()) {
      abort(state);
      if (clear) state.items.clear();
      const epoch = state.snapshot.searchEpoch + 1;
      state.snapshot = { id: state.definition.id, status: "idle", searchEpoch: epoch };
      if (
        !dependencies.getOpened() ||
        frame.composing ||
        frame.query.length < (state.definition.minQueryLength ?? 0)
      ) {
        continue;
      }
      state.snapshot = { id: state.definition.id, status: "loading", searchEpoch: epoch };
      const delay = Math.max(0, state.definition.debounceMs ?? 0);
      if (delay) {
        state.timer = setTimeout(() => {
          state.timer = undefined;
          void run(frame, state);
        }, delay);
      } else {
        void run(frame, state);
      }
    }
  }

  return {
    abort,
    sync,
    start,
    loadMore: run,
  };
}
