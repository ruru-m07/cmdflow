import { createCandidateId, createRankingSurfaceId, immutable } from "./identity.js";
import {
  createMemoryRankingStore,
  deriveRankingQueryKey,
  normalizeQueryV1,
  QUERY_NORMALIZATION_VERSION,
  rankItems,
} from "./ranking.js";
import type {
  RankExplanation,
  RankingProfile,
  RankingQueryKey,
  RankingScope,
} from "./ranking-types.js";
import type {
  ActionDefinition,
  ActionEvaluation,
  ActionOutcome,
  ActionRunInput,
  ActionSnapshot,
  Availability,
  CandidateId,
  CmdFlow,
  CmdFlowOptions,
  CmdFlowSnapshot,
  CommandDefinition,
  ConfirmationSnapshot,
  ContextStore,
  DiagnosticEvent,
  DomEffect,
  ExecutionResult,
  ExecutionSnapshot,
  ExtensionDefinition,
  FormSnapshot,
  FrameSnapshot,
  ResolvedItem,
  ResultBatch,
  ResultSource,
  SourceSnapshot,
  Surface,
  SurfaceAddress,
  ViewDefinition,
} from "./types.js";

interface SourceState<T> {
  definition: ResultSource<T>;
  items: Map<string, CommandDefinition<T>>;
  snapshot: SourceSnapshot;
  controller?: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  pageId: number;
  iterator?: AsyncIterator<ResultBatch<T>>;
}
interface Frame<T> {
  id: string;
  surface: Surface;
  definition: ViewDefinition<T>;
  query: string;
  committedQuery: string;
  composing: boolean;
  activeId: CandidateId | null;
  selectedIds: CandidateId[];
  sources: Map<string, SourceState<T>>;
  scrollAnchor: FrameSnapshot["scrollAnchor"];
  form: FormSnapshot;
  snapshot: FrameSnapshot;
  candidates: Map<CandidateId, CommandDefinition<T>>;
  staticItems: Map<
    CandidateId,
    { command: CommandDefinition<T>; sourcePriority: number; item: ResolvedItem }
  >;
  actionOrigin?: { frameId: string; candidateId?: CandidateId };
  navigationRevision: number;
  formVersion: number;
  validation?: AbortController;
  queryKey?: RankingQueryKey;
  queryKeyGeneration: number;
  rankExplanations: readonly RankExplanation[];
}
interface Running<T> {
  controller: AbortController;
  frame: Frame<T>;
  session: number;
  action: ActionDefinition<T>;
  candidateId?: CandidateId;
  mainId: string;
  actionsId?: string;
  owner?: { command?: CommandDefinition<T>; source?: ResultSource<T> };
  allowUi: boolean;
}

function isContextStore<T>(value: unknown): value is ContextStore<T> {
  return !!value && typeof value === "object" && "getSnapshot" in value && "subscribe" in value;
}
function available(value: Availability | undefined): {
  disabled: boolean;
  disabledReason?: string;
} {
  if (value === false) return { disabled: true };
  if (typeof value === "object") return { disabled: true, disabledReason: value.reason };
  return { disabled: false };
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function abortable<T>(value: T | PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Operation aborted"));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(value)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
function terminal(id: string, status: ExecutionResult["status"], error?: string): ExecutionResult {
  return Object.freeze({ id, status, ...(error ? { error } : {}) });
}

export function createCmdFlow<T = Record<string, never>>(
  options: CmdFlowOptions<T> = {},
): CmdFlow<T> {
  const id = options.id ?? "cmdflow";
  const clock = options.clock ?? { now: () => Date.now() };
  // Persisted idempotency receipts outlive stores and page reloads. These are operation
  // identifiers, not security tokens; never derive them from query or application data.
  const executionNamespace = `${clock.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  const contextStore = isContextStore<T>(options.context) ? options.context : undefined;
  let context = contextStore ? contextStore.getSnapshot() : ((options.context ?? {}) as T);
  const root = options.root ?? { id: "root", type: "list", title: "Commands" };
  const commands = new Map<string, CommandDefinition<T>>();
  const sources = new Map<string, ResultSource<T>>();
  const extensions = new Map<string, ExtensionDefinition<T>>();
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(event: DiagnosticEvent) => void>();
  const running = new Map<string, Running<T>>();
  const executions = new Map<string, ExecutionSnapshot>();
  const main: Frame<T>[] = [];
  const actions: Frame<T>[] = [];
  let opened = false;
  let destroyed = false;
  let session = 0;
  let revision = 0;
  let serial = 0;
  let effectSerial = 0;
  let effects: DomEffect[] = [];
  let confirmation: ConfirmationSnapshot | null = null;
  let confirmWork: (() => Promise<void>) | null = null;
  let snapshot!: CmdFlowSnapshot;
  let serverSnapshot: CmdFlowSnapshot;
  const profiles = new Map<string, RankingProfile>();
  const deferredProfiles = new Map<string, RankingProfile>();
  let rankingReady = false;
  let rankingGeneration = 0;
  let rankingWriteGeneration = 0;
  let userNavigated = false;
  const rankingStore =
    options.ranking?.store ??
    createMemoryRankingStore({ now: () => clock.now(), allowPlainQueryKeys: true });
  const rankingScope: RankingScope = options.ranking?.scope ?? {
    subjectKey: "anonymous",
    surfaceId: id,
  };

  function diagnostic(type: string, eventId?: string, detail?: string) {
    const event = Object.freeze({ type, id: eventId, message: detail, time: clock.now() });
    try {
      options.onDiagnostic?.(event);
    } catch {
      /* Diagnostics must not interrupt commands. */
    }
    for (const listener of [...eventListeners]) {
      try {
        listener(event);
      } catch {
        /* Host isolation. */
      }
    }
  }
  function current(surface?: Surface): Frame<T> {
    const stack =
      surface === "main" ? main : surface === "actions" ? actions : actions.length ? actions : main;
    const frame = stack.at(-1);
    if (!frame) throw new Error("The requested CmdFlow surface is not open");
    return frame;
  }
  function find(address?: SurfaceAddress): Frame<T> | undefined {
    if (!address) return current();
    return (address.surface === "main" ? main : actions).find(
      (frame) => frame.id === address.frameId,
    );
  }
  function frameAlive(frame: Frame<T>) {
    return !destroyed && (main.includes(frame) || actions.includes(frame));
  }
  function scope(frame: Frame<T>): RankingScope {
    return {
      ...rankingScope,
      surfaceId: createRankingSurfaceId(rankingScope.surfaceId, frame.surface, frame.definition.id),
      ...(frame.definition.rankingContextKey
        ? { contextKey: frame.definition.rankingContextKey }
        : {}),
    };
  }
  function effect(
    type: DomEffect["type"],
    extras: Omit<DomEffect, "id" | "revision" | "type"> = {},
  ) {
    if (type === "focus" || type === "scroll")
      effects = effects.filter((entry) => entry.type !== type || entry.frameId !== extras.frameId);
    effects.push(Object.freeze({ id: ++effectSerial, revision: revision + 1, type, ...extras }));
  }
  function frameDescriptor(definition: ViewDefinition<T>): FrameSnapshot["view"] {
    return immutable({
      id: definition.id,
      type: definition.type,
      title: definition.title ?? definition.id,
      description: definition.description,
      rendererKey: definition.rendererKey,
      payloadKey: definition.payloadKey,
      selectionMode: definition.selectionMode ?? "none",
      fields: (definition.fields ?? []).map(({ validate: _validate, ...field }) => field),
    });
  }
  function makeFrame(definition: ViewDefinition<T>, surface: Surface): Frame<T> {
    const values = Object.fromEntries(
      (definition.fields ?? []).map((field) => [
        field.id,
        field.defaultValue ?? (field.type === "checkbox" ? false : ""),
      ]),
    );
    const form = immutable({ values, errors: {}, dirty: false, submitting: false });
    const frameId = `${id}:frame:${++serial}`;
    const initial: FrameSnapshot = immutable({
      id: frameId,
      surface,
      view: frameDescriptor(definition),
      query: "",
      composing: false,
      activeId: null,
      selectedIds: [],
      items: [],
      sources: [],
      actions: [],
      scrollAnchor: null,
      form,
    });
    return {
      id: frameId,
      surface,
      definition,
      query: "",
      committedQuery: "",
      composing: false,
      activeId: null,
      selectedIds: [],
      sources: new Map(),
      scrollAnchor: null,
      form,
      snapshot: initial,
      candidates: new Map(),
      staticItems: new Map(),
      navigationRevision: 0,
      formVersion: 0,
      queryKeyGeneration: 0,
      rankExplanations: [],
    };
  }
  function evaluation(frame: Frame<T>, candidateId?: CandidateId): ActionEvaluation<T> {
    const origin = frame.actionOrigin;
    const actual = origin ? (main.find((entry) => entry.id === origin.frameId) ?? frame) : frame;
    const active = origin?.candidateId ?? candidateId;
    return {
      appContext: context,
      frame: actual.snapshot,
      surface: frame.surface,
      item: active
        ? (actual.snapshot.items.find((item) => item.candidateId === active) ?? null)
        : null,
      selection: actual.snapshot.selectedIds,
    };
  }
  function actionSnapshot(
    action: ActionDefinition<T>,
    input: ActionEvaluation<T>,
  ): ActionSnapshot | null {
    try {
      if (action.visible && !action.visible(input)) return null;
      return immutable({
        id: action.id,
        title: action.title,
        subtitle: action.subtitle,
        shortcut: action.shortcut,
        section: action.section,
        destructive: action.destructive ?? false,
        ...available(action.enabled?.(input)),
        priority: action.priority ?? "auxiliary",
        hasChildren: !!action.children?.length,
      });
    } catch (error) {
      diagnostic("predicate-error", action.id, message(error));
      return null;
    }
  }
  function actionDefinitions(command: CommandDefinition<T>): readonly ActionDefinition<T>[] {
    return command.actions ?? (command.run || command.view || command.children ? [command] : []);
  }
  function actionSnapshots(
    definitions: readonly ActionDefinition<T>[],
    input: ActionEvaluation<T>,
  ): readonly ActionSnapshot[] {
    const result = definitions
      .map((action) => actionSnapshot(action, input))
      .filter((item): item is ActionSnapshot => !!item);
    const priorities = new Set<string>();
    let normalized = result.map((item) => {
      if (item.priority === "auxiliary") return item;
      if (priorities.has(item.priority)) {
        diagnostic("duplicate-priority", item.id);
        return { ...item, priority: "auxiliary" as const };
      }
      priorities.add(item.priority);
      return item;
    });
    if (!priorities.has("primary")) {
      const first = normalized.find((item) => !item.disabled && !item.destructive);
      normalized = normalized.map((item) =>
        item === first ? { ...item, priority: "primary" as const } : item,
      );
    }
    return immutable(normalized);
  }
  function buildFrame(frame: Frame<T>) {
    const candidates = new Map<CandidateId, CommandDefinition<T>>();
    const resolved: ResolvedItem[] = [];
    const collect = (
      sourceId: string,
      definitions: Iterable<CommandDefinition<T>>,
      sourcePriority = 0,
    ) => {
      for (const command of definitions) {
        const candidateId = createCandidateId(sourceId, command.id);
        const cached = frame.staticItems.get(candidateId);
        if (cached?.command === command && cached.sourcePriority === sourcePriority) {
          candidates.set(candidateId, command);
          resolved.push(cached.item);
          continue;
        }
        const preliminary = immutable({
          candidateId,
          id: command.id,
          sourceId,
          title: command.title,
          subtitle: command.subtitle,
          keywords: command.keywords,
          aliases: command.aliases,
          section: command.section,
          data: command.data,
          providerRank: command.providerRank,
          favorite: command.favorite,
          contextTier: command.contextTier,
          allowFallback: command.allowFallback,
          personalize: command.personalize,
          sourcePriority,
          disabled: false,
          actions: [],
        });
        const input = frame.actionOrigin
          ? evaluation(frame, candidateId)
          : { ...evaluation(frame), item: preliminary };
        try {
          if (command.visible && !command.visible(input)) continue;
          const disabled =
            command.disabled === true
              ? { disabled: true }
              : typeof command.disabled === "object"
                ? { disabled: true, disabledReason: command.disabled.reason }
                : available(command.enabled?.(input));
          const item = immutable({
            candidateId,
            id: command.id,
            sourceId,
            title: command.title,
            subtitle: command.subtitle,
            keywords: command.keywords,
            aliases: command.aliases,
            section: command.section,
            data: command.data,
            providerRank: command.providerRank,
            favorite: command.favorite,
            contextTier: command.contextTier,
            allowFallback: command.allowFallback,
            personalize: command.personalize,
            sourcePriority,
            ...disabled,
            actions: actionSnapshots(actionDefinitions(command), input),
          });
          candidates.set(candidateId, command);
          resolved.push(item);
          if (
            !command.visible &&
            !command.enabled &&
            !actionDefinitions(command).some((action) => action.visible || action.enabled)
          ) {
            frame.staticItems.set(candidateId, { command, sourcePriority, item });
          } else frame.staticItems.delete(candidateId);
        } catch (error) {
          diagnostic("command-error", command.id, message(error));
        }
      }
    };
    if (frame === main[0]) collect("registry", commands.values());
    collect(`view:${frame.definition.id}`, frame.definition.items ?? []);
    for (const [sourceId, state] of frame.sources)
      collect(sourceId, state.items.values(), state.definition.sourcePriority ?? 0);
    for (const candidateId of frame.staticItems.keys())
      if (!candidates.has(candidateId)) frame.staticItems.delete(candidateId);
    const frameScope = scope(frame);
    const ranked = rankItems(resolved, {
      query: frame.query,
      scope: frameScope,
      profile: profiles.get(JSON.stringify(frameScope)),
      now: clock.now(),
      queryKey: frame.queryKey,
    });
    frame.rankExplanations = ranked.explanations;
    const items = ranked.items;
    frame.candidates = candidates;
    const previousIndex = frame.snapshot.items.findIndex(
      (entry) => entry.candidateId === frame.activeId,
    );
    if (!items.some((entry) => entry.candidateId === frame.activeId))
      frame.activeId =
        items[Math.max(0, Math.min(previousIndex, items.length - 1))]?.candidateId ?? null;
    frame.selectedIds = frame.selectedIds.filter((entry) =>
      items.some((item) => item.candidateId === entry),
    );
    const active = frame.activeId ? candidates.get(frame.activeId) : undefined;
    const definitions = active ? actionDefinitions(active) : (frame.definition.actions ?? []);
    frame.snapshot = immutable({
      id: frame.id,
      surface: frame.surface,
      view: frameDescriptor(frame.definition),
      query: frame.query,
      composing: frame.composing,
      activeId: frame.activeId,
      selectedIds: frame.selectedIds,
      items,
      sources: [...frame.sources.values()].map((state) => state.snapshot),
      actions: [],
      scrollAnchor: frame.scrollAnchor,
      form: frame.form,
    });
    frame.snapshot = immutable({
      ...frame.snapshot,
      actions: actionSnapshots(definitions, evaluation(frame, frame.activeId ?? undefined)),
    });
  }
  function sameActionSnapshots(left: readonly ActionSnapshot[], right: readonly ActionSnapshot[]) {
    return (
      left.length === right.length &&
      left.every((action, index) => {
        const other = right[index];
        if (!other) return false;
        return (
          action.id === other.id &&
          action.title === other.title &&
          action.subtitle === other.subtitle &&
          action.section === other.section &&
          action.destructive === other.destructive &&
          action.disabled === other.disabled &&
          action.disabledReason === other.disabledReason &&
          action.priority === other.priority &&
          action.hasChildren === other.hasChildren &&
          action.shortcut?.key === other.shortcut?.key &&
          action.shortcut?.mod === other.shortcut?.mod &&
          action.shortcut?.ctrl === other.shortcut?.ctrl &&
          action.shortcut?.meta === other.shortcut?.meta &&
          action.shortcut?.alt === other.shortcut?.alt &&
          action.shortcut?.shift === other.shortcut?.shift
        );
      })
    );
  }
  /** Interaction commits retain search order and payload identity while reevaluating actions. */
  function refreshInteraction(frame: Frame<T>) {
    const previous = frame.snapshot;
    const sameSelection =
      previous.selectedIds.length === frame.selectedIds.length &&
      previous.selectedIds.every((id, index) => id === frame.selectedIds[index]);
    frame.snapshot = Object.freeze({
      ...previous,
      activeId: frame.activeId,
      selectedIds: sameSelection ? previous.selectedIds : Object.freeze([...frame.selectedIds]),
    });
    const origin = frame.actionOrigin;
    const actual = origin ? (main.find((entry) => entry.id === origin.frameId) ?? frame) : frame;
    const lookup = new Map(actual.snapshot.items.map((item) => [item.candidateId, item]));
    const evaluate = (candidateId?: CandidateId): ActionEvaluation<T> => ({
      appContext: context,
      frame: actual.snapshot,
      surface: frame.surface,
      item: lookup.get(origin?.candidateId ?? (candidateId as CandidateId)) ?? null,
      selection: actual.snapshot.selectedIds,
    });
    let changedItems = false;
    const items = previous.items.map((item) => {
      const command = frame.candidates.get(item.candidateId);
      if (!command) return item;
      const definitions = actionDefinitions(command);
      if (!definitions.some((action) => action.visible || action.enabled)) return item;
      const nextActions = actionSnapshots(definitions, evaluate(item.candidateId));
      if (sameActionSnapshots(item.actions, nextActions)) return item;
      changedItems = true;
      return Object.freeze({ ...item, actions: nextActions });
    });
    const active = frame.activeId ? frame.candidates.get(frame.activeId) : undefined;
    const nextActions = active
      ? (items.find((item) => item.candidateId === frame.activeId)?.actions ?? [])
      : actionSnapshots(frame.definition.actions ?? [], evaluate());
    frame.snapshot = Object.freeze({
      ...frame.snapshot,
      items: changedItems ? Object.freeze(items) : previous.items,
      actions: sameActionSnapshots(previous.actions, nextActions) ? previous.actions : nextActions,
    });
  }
  function publishInteraction(frame: Frame<T>) {
    refreshInteraction(frame);
    for (const actionFrame of actions)
      if (actionFrame.actionOrigin?.frameId === frame.id) refreshInteraction(actionFrame);
    publish(false);
  }
  function publish(rebuild = true) {
    if (destroyed && snapshot?.destroyed) return;
    if (rebuild) for (const frame of [...main, ...actions]) buildFrame(frame);
    snapshot = Object.freeze({
      revision: ++revision,
      open: opened,
      sessionId: session,
      main: Object.freeze(main.map((frame) => frame.snapshot)),
      actions: Object.freeze(actions.map((frame) => frame.snapshot)),
      current: current("main").snapshot,
      actionFrame: actions.at(-1)?.snapshot ?? null,
      executions: Object.freeze([...executions.values()]),
      confirmation,
      rankingReady,
      destroyed,
    });
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        diagnostic("subscriber-error", undefined, message(error));
      }
    }
  }

  function closeIterator(iterator: AsyncIterator<ResultBatch<T>> | undefined, sourceId: string) {
    if (!iterator?.return) return;
    try {
      void Promise.resolve(iterator.return()).catch((error) =>
        diagnostic("source-cleanup-error", sourceId, message(error)),
      );
    } catch (error) {
      diagnostic("source-cleanup-error", sourceId, message(error));
    }
  }
  function abortSource(state: SourceState<T>) {
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
  function disposeFrame(frame: Frame<T>) {
    frame.validation?.abort();
    for (const state of frame.sources.values()) abortSource(state);
    for (const task of running.values())
      if (task.frame === frame && task.action.lifecycle !== "detached") task.controller.abort();
    effects = effects.filter((entry) => entry.frameId !== frame.id);
  }
  function sourceDefinitions(frame: Frame<T>): readonly ResultSource<T>[] {
    if (frame.definition.type !== "list") return [];
    const ids = frame.definition.sourceIds;
    if (ids)
      return ids.flatMap((sourceId) => {
        const source = sources.get(sourceId);
        return source ? [source] : [];
      });
    return frame === main[0] ? [...sources.values()] : [];
  }
  function syncSources(frame: Frame<T>) {
    const definitions = sourceDefinitions(frame);
    for (const [sourceId, state] of frame.sources) {
      if (!definitions.some((source) => source.id === sourceId && source === state.definition)) {
        abortSource(state);
        frame.sources.delete(sourceId);
      }
    }
    for (const definition of definitions) {
      if (!frame.sources.has(definition.id))
        frame.sources.set(definition.id, {
          definition,
          items: new Map(),
          pageId: 0,
          snapshot: { id: definition.id, status: "idle", searchEpoch: 0 },
        });
    }
  }
  function validateSourceId(sourceId: string) {
    if (sourceId === "registry" || sourceId.startsWith("view:"))
      throw new Error(`Reserved CmdFlow source namespace: ${sourceId}`);
  }
  async function runSource(frame: Frame<T>, state: SourceState<T>, cursor?: string) {
    const controller = new AbortController();
    state.controller = controller;
    const epoch = state.snapshot.searchEpoch;
    const pageId = ++state.pageId;
    const openSession = session;
    const valid = () =>
      opened &&
      openSession === session &&
      frameAlive(frame) &&
      frame.sources.get(state.definition.id) === state &&
      state.snapshot.searchEpoch === epoch &&
      state.pageId === pageId &&
      !controller.signal.aborted;
    state.snapshot = { id: state.definition.id, status: "loading", searchEpoch: epoch };
    publish();
    diagnostic("source-start", state.definition.id);
    let done = false;
    const applyBatch = (batch: ResultBatch<T>) => {
      if (!valid()) return;
      if (done) {
        diagnostic("source-after-complete", state.definition.id);
        return;
      }
      if (cursor && batch.operation === "replace")
        throw new Error("Paginated CmdFlow sources must emit patch batches");
      let nextItems =
        batch.operation === "replace"
          ? new Map<string, CommandDefinition<T>>()
          : new Map(state.items);
      if (batch.operation === "patch")
        for (const itemId of batch.remove ?? []) nextItems.delete(itemId);
      const batchIds = new Set<string>();
      for (const item of batch.items) {
        if (batchIds.has(item.id)) diagnostic("duplicate-source-item", item.id);
        if (!valid()) return;
        batchIds.add(item.id);
        nextItems.set(item.id, immutable(item));
      }
      if (state.definition.limit !== undefined) {
        const sorted = [...nextItems].sort(
          ([aId, a], [bId, b]) =>
            (a.providerRank ?? 0) - (b.providerRank ?? 0) || (aId < bId ? -1 : aId > bId ? 1 : 0),
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
      effect("scroll", { frameId: frame.id });
      if (done)
        effect("announce", { message: `${state.items.size} results from ${state.definition.id}` });
      publish();
      diagnostic("source-batch", state.definition.id);
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
        context,
        scope: scope(frame),
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
              diagnostic("source-missing-final", state.definition.id);
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
        if (!batch.done)
          throw new Error("A synchronous or Promise source must return a final batch");
        applyBatch(batch);
      }
      if (valid()) diagnostic("source-success", state.definition.id);
    } catch (error) {
      if (valid()) {
        state.snapshot = {
          id: state.definition.id,
          status: "error",
          error: message(error),
          searchEpoch: epoch,
          ...(cursor ? { nextCursor: cursor } : {}),
        };
        effect("announce", { message: `Could not load ${state.definition.id}` });
        publish();
        diagnostic("source-error", state.definition.id, message(error));
      } else diagnostic("source-abort", state.definition.id);
    } finally {
      if (state.controller === controller) {
        const iterator = state.iterator;
        state.controller = undefined;
        state.iterator = undefined;
        closeIterator(iterator, state.definition.id);
      }
    }
  }
  function startSources(frame: Frame<T>, clear = true) {
    syncSources(frame);
    for (const state of frame.sources.values()) {
      abortSource(state);
      if (clear) state.items.clear();
      const epoch = state.snapshot.searchEpoch + 1;
      state.snapshot = { id: state.definition.id, status: "idle", searchEpoch: epoch };
      if (!opened || frame.composing || frame.query.length < (state.definition.minQueryLength ?? 0))
        continue;
      state.snapshot = { id: state.definition.id, status: "loading", searchEpoch: epoch };
      const delay = Math.max(0, state.definition.debounceMs ?? 0);
      if (delay)
        state.timer = setTimeout(() => {
          state.timer = undefined;
          void runSource(frame, state);
        }, delay);
      else void runSource(frame, state);
    }
  }
  async function hydrateRanking() {
    const generation = ++rankingGeneration;
    try {
      const loaded = await Promise.all(
        [...main, ...actions].map(async (frame) => {
          const frameScope = scope(frame);
          return [
            JSON.stringify(frameScope),
            await rankingStore.load({ scope: frameScope, now: clock.now() }),
          ] as const;
        }),
      );
      if (destroyed || generation !== rankingGeneration) return;
      for (const [key, profile] of loaded)
        (userNavigated ? deferredProfiles : profiles).set(key, profile);
    } catch (error) {
      diagnostic("ranking-storage-error", undefined, message(error));
    }
    if (destroyed || generation !== rankingGeneration) return;
    rankingReady = true;
    publish(!userNavigated);
  }
  async function deriveQuery(frame: Frame<T>) {
    const generation = ++frame.queryKeyGeneration;
    const query = frame.query;
    if (frame.definition.learnableQuery === false || frame.definition.type !== "list") {
      frame.queryKey = undefined;
      return;
    }
    const configured = options.ranking?.queryPolicy ?? { strategy: "plain" as const };
    if (typeof configured !== "function" && configured.strategy !== "fingerprint") {
      frame.queryKey =
        configured.strategy === "plain" && query
          ? { strategy: "plain", value: normalizeQueryV1(query) }
          : undefined;
      return;
    }
    frame.queryKey = undefined;
    const navigation = frame.navigationRevision;
    try {
      const policy = typeof configured === "function" ? await configured(scope(frame)) : configured;
      const key = await deriveRankingQueryKey(query, scope(frame), policy);
      if (!frameAlive(frame) || generation !== frame.queryKeyGeneration || query !== frame.query)
        return;
      frame.queryKey = key;
      if (frame.navigationRevision === navigation) publish();
    } catch (error) {
      diagnostic("query-key-error", frame.id, message(error));
    }
  }
  function closeActionStack() {
    for (const frame of actions.splice(0)) disposeFrame(frame);
    effect("restore");
  }
  function removeFrames(surface: Surface, from: number) {
    const stack = surface === "main" ? main : actions;
    for (const frame of stack.splice(from)) disposeFrame(frame);
  }
  function requestDiscard(work: () => void, affected = [...main, ...actions]): boolean {
    const dirty = affected.some((frame) => frame.form.dirty);
    if (!dirty) return false;
    confirmation = Object.freeze({
      id: `${id}:confirm:${++serial}`,
      kind: "discard",
      title: "Discard unsaved changes?",
    });
    confirmWork = async () => {
      for (const frame of affected) frame.form = immutable({ ...frame.form, dirty: false });
      work();
    };
    effect("focus", { target: "confirmation" });
    publish();
    return true;
  }
  function releaseRanking() {
    userNavigated = false;
    for (const [key, profile] of deferredProfiles) profiles.set(key, profile);
    deferredProfiles.clear();
  }
  function openState(value: boolean) {
    if (destroyed || value === opened) return;
    opened = value;
    session += 1;
    if (value) {
      releaseRanking();
      for (const frame of main) void deriveQuery(frame);
      void hydrateRanking();
      effect("focus", {
        frameId: current().id,
        target: current().definition.type === "form" ? "form" : "input",
      });
      startSources(current("main"), false);
    } else {
      closeActionStack();
      for (const frame of main) {
        frame.validation?.abort();
        for (const state of frame.sources.values()) abortSource(state);
      }
      for (const task of running.values())
        if (task.action.lifecycle !== "detached") task.controller.abort();
      confirmation = null;
      confirmWork = null;
      effect("restore");
    }
    publish();
    diagnostic(value ? "open" : "close");
  }
  function queryState(query: string, frame: Frame<T>, composing: boolean) {
    if (destroyed || (frame.query === query && frame.composing === composing)) return;
    const changed = frame.query !== query;
    frame.query = query;
    frame.composing = composing;
    if (!composing) frame.committedQuery = query;
    if (changed) frame.navigationRevision += 1;
    if (frame.surface === "main" && actions.length) closeActionStack();
    if (!composing) {
      releaseRanking();
      void deriveQuery(frame);
      startSources(frame);
    } else for (const state of frame.sources.values()) abortSource(state);
    effect("scroll", { frameId: frame.id });
    if (composing) {
      frame.snapshot = immutable({ ...frame.snapshot, query, composing });
      publish(false);
    } else publish();
    diagnostic("query-change", frame.id);
  }

  function pushFrame(
    definition: ViewDefinition<T>,
    surface: Surface,
    replace = false,
    discarded = false,
  ) {
    if (destroyed) return;
    const stack = surface === "main" ? main : actions;
    const replacing = replace ? stack.at(-1) : undefined;
    if (
      !discarded &&
      replacing &&
      requestDiscard(() => pushFrame(definition, surface, replace, true), [replacing])
    )
      return;
    const origin = actions.at(-1)?.actionOrigin;
    if (replace && stack.length) disposeFrame(stack.pop() as Frame<T>);
    if (surface === "main") closeActionStack();
    const frame = makeFrame(immutable(definition), surface);
    if (surface === "actions") frame.actionOrigin = origin;
    stack.push(frame);
    releaseRanking();
    void deriveQuery(frame);
    void hydrateRanking();
    startSources(frame);
    effect("focus", { frameId: frame.id, target: definition.type === "form" ? "form" : "input" });
    publish();
    diagnostic(replace ? "view-replace" : "view-push", definition.id);
  }
  function popFrame(surface: Surface) {
    const stack = surface === "main" ? main : actions;
    if (surface === "main" && stack.length <= 1) return;
    const frame = stack.at(-1);
    if (!frame) return;
    const doPop = () => {
      if (surface === "main") closeActionStack();
      disposeFrame(stack.pop() as Frame<T>);
      if (stack.length) {
        effect("focus", {
          frameId: current(surface).id,
          target: current(surface).definition.type === "form" ? "form" : "input",
        });
        effect("scroll", { frameId: current(surface).id });
      } else effect("restore");
      publish();
      diagnostic("view-pop", frame.definition.id);
    };
    if (requestDiscard(doPop, surface === "main" ? [frame, ...actions] : [frame])) return;
    doPop();
  }
  function resolveAction(
    frame: Frame<T>,
    candidateId?: CandidateId,
    actionId?: string,
  ): ActionDefinition<T> | undefined {
    const command = candidateId ? frame.candidates.get(candidateId) : undefined;
    // Selecting a contextual action is explicit intent, including destructive actions
    // which still pass through execute's confirmation gate. Main-list Enter is primary-only.
    if (frame.surface === "actions" && command && !command.actions && !actionId) return command;
    const definitions = command ? actionDefinitions(command) : (frame.definition.actions ?? []);
    if (actionId)
      return (
        definitions.find((action) => action.id === actionId) ??
        (frame.definition.submit?.id === actionId ? frame.definition.submit : undefined)
      );
    const snapshots = actionSnapshots(definitions, evaluation(frame, candidateId));
    const primary = snapshots.find((action) => action.priority === "primary");
    return definitions.find((action) => action.id === primary?.id);
  }
  // biome-ignore lint/suspicious/noConfusingVoidType: Preserve the intentional void return contract of action handlers.
  function applyOutcome(outcome: ActionOutcome<T> | void, task: Running<T>) {
    if (!outcome || outcome.type === "stay") return;
    if (!task.allowUi) {
      diagnostic("outcome-without-origin", task.action.id);
      return;
    }
    if (!opened || session !== task.session || !frameAlive(task.frame)) return;
    if (current("main").id !== task.mainId || actions.at(-1)?.id !== task.actionsId) return;
    if (outcome.type === "close") {
      if (outcome.target === "actions") api.closeActions();
      else api.close();
      return;
    }
    const surface =
      outcome.target === "origin" || !outcome.target ? task.frame.surface : outcome.target;
    if (outcome.type === "pop-view") popFrame(surface);
    else pushFrame(outcome.view, surface, outcome.type === "replace-view");
  }
  async function execute(
    frame: Frame<T>,
    candidateId: CandidateId | undefined,
    action: ActionDefinition<T>,
    confirmed = false,
    submittedVersion?: number,
    allowUi = true,
  ): Promise<ExecutionResult> {
    const executionId = `${id}:${executionNamespace}:execution:${++serial}`;
    if (!frameAlive(frame)) return terminal(executionId, "aborted");
    if (candidateId && !frame.candidates.has(candidateId)) return terminal(executionId, "disabled");
    const input = evaluation(frame, candidateId);
    const actionState = actionSnapshot(action, input);
    const item = candidateId
      ? frame.snapshot.items.find((entry) => entry.candidateId === candidateId)
      : undefined;
    if (!actionState || actionState.disabled || item?.disabled)
      return terminal(executionId, "disabled");
    if (action.destructive && !confirmed) {
      confirmation = Object.freeze({
        id: executionId,
        kind: "destructive",
        title: `${action.title}?`,
      });
      const confirmationSession = session;
      const confirmedCommand = candidateId ? frame.candidates.get(candidateId) : undefined;
      confirmWork = async () => {
        if (
          frameAlive(frame) &&
          confirmationSession === session &&
          (!candidateId || frame.candidates.get(candidateId) === confirmedCommand)
        )
          await execute(frame, candidateId, action, true, submittedVersion, allowUi);
      };
      effect("focus", { target: "confirmation" });
      publish();
      return terminal(executionId, "confirmation");
    }
    const controller = new AbortController();
    const originFrame = frame.actionOrigin
      ? (main.find((entry) => entry.id === frame.actionOrigin?.frameId) ?? frame)
      : frame;
    const originCandidateId = frame.actionOrigin?.candidateId ?? candidateId;
    const originItem = originFrame.snapshot.items.find(
      (entry) => entry.candidateId === originCandidateId,
    );
    const originCommand = originCandidateId
      ? originFrame.candidates.get(originCandidateId)
      : undefined;
    try {
      const originInput = evaluation(originFrame, originCandidateId);
      if (
        originCommand &&
        (originCommand.visible?.(originInput) === false ||
          available(originCommand.enabled?.(originInput)).disabled ||
          originCommand.disabled === true ||
          typeof originCommand.disabled === "object")
      )
        return terminal(executionId, "disabled");
    } catch (error) {
      diagnostic("predicate-error", action.id, message(error));
      return terminal(executionId, "disabled");
    }
    const task: Running<T> = {
      controller,
      frame,
      session,
      action,
      candidateId,
      mainId: current("main").id,
      actionsId: actions.at(-1)?.id,
      allowUi,
      owner: {
        command: originCommand,
        source: originItem ? originFrame.sources.get(originItem.sourceId)?.definition : undefined,
      },
    };
    const feedbackScope = scope(originFrame);
    const feedbackQuery = originFrame.query;
    const feedbackKey = originFrame.queryKey;
    const feedbackGeneration = rankingWriteGeneration;
    const shouldLearn =
      originCandidateId &&
      action.learn !== false &&
      (!action.children || action.learn === true) &&
      originCommand?.personalize !== false &&
      originFrame.definition.learnableQuery !== false &&
      originFrame.definition.type === "list";
    userNavigated = true;
    running.set(executionId, task);
    executions.set(
      executionId,
      Object.freeze({ id: executionId, actionId: action.id, frameId: frame.id, status: "pending" }),
    );
    while (executions.size > 50) {
      const first = [...executions].find(([key]) => !running.has(key));
      if (!first) break;
      executions.delete(first[0]);
    }
    publish();
    diagnostic("execution-start", action.id);
    try {
      if (controller.signal.aborted || !frameAlive(frame)) throw new Error("Operation aborted");
      const runInput = {
        ...input,
        signal: controller.signal,
        executionId,
        values: frame.form.values,
      };
      const outcome = action.children
        ? {
            type: "push-view" as const,
            target: "actions" as const,
            view: {
              id: action.id,
              type: "list" as const,
              title: action.title,
              items: action.children,
            },
          }
        : action.view
          ? { type: "push-view" as const, target: "main" as const, view: action.view }
          : await abortable(action.run?.(runInput), controller.signal);
      if (controller.signal.aborted || destroyed) {
        executions.set(
          executionId,
          Object.freeze({
            id: executionId,
            actionId: action.id,
            frameId: frame.id,
            status: "aborted",
          }),
        );
        publish();
        return terminal(executionId, "aborted");
      }
      executions.set(
        executionId,
        Object.freeze({
          id: executionId,
          actionId: action.id,
          frameId: frame.id,
          status: "success",
        }),
      );
      if (submittedVersion !== undefined && frame.formVersion === submittedVersion) {
        frame.form = immutable({ ...frame.form, dirty: false });
      }
      applyOutcome(outcome, task);
      effect("announce", { message: `${action.title} completed` });
      publish();
      diagnostic("execution-success", action.id);
      if (shouldLearn && originCandidateId) {
        const occurredAt = clock.now();
        // Storage and fingerprinting must never delay the command's UI outcome.
        void (async () => {
          try {
            const configured = options.ranking?.queryPolicy ?? { strategy: "plain" as const };
            const policy =
              typeof configured === "function" ? await configured(feedbackScope) : configured;
            const queryKey =
              feedbackKey ?? (await deriveRankingQueryKey(feedbackQuery, feedbackScope, policy));
            if (destroyed || feedbackGeneration !== rankingWriteGeneration) return;
            await rankingStore.commit({
              operationId: executionId,
              candidateId: originCandidateId,
              scope: feedbackScope,
              queryKey,
              occurredAt,
            });
            await hydrateRanking();
            diagnostic("ranking-feedback", originCandidateId);
          } catch (error) {
            diagnostic("ranking-storage-error", originCandidateId, message(error));
          }
        })();
      }
      return terminal(executionId, "success");
    } catch (error) {
      const status = controller.signal.aborted ? "aborted" : "error";
      executions.set(
        executionId,
        Object.freeze({
          id: executionId,
          actionId: action.id,
          frameId: frame.id,
          status,
          ...(status === "error" ? { error: message(error) } : {}),
        }),
      );
      if (status === "error") effect("announce", { message: `${action.title} failed` });
      publish();
      diagnostic(`execution-${status}`, action.id, status === "error" ? message(error) : undefined);
      return terminal(executionId, status, status === "error" ? message(error) : undefined);
    } finally {
      running.delete(executionId);
    }
  }

  function ensureMutable() {
    if (destroyed) throw new Error("This CmdFlow instance has been destroyed");
  }
  function registerExtension(extension: ExtensionDefinition<T>): () => void {
    ensureMutable();
    const commandIds = (extension.commands ?? []).map((command) => command.id);
    const sourceIds = (extension.sources ?? []).map((source) => source.id);
    for (const sourceId of sourceIds) validateSourceId(sourceId);
    if (
      extensions.has(extension.id) ||
      new Set(commandIds).size !== commandIds.length ||
      new Set(sourceIds).size !== sourceIds.length ||
      commandIds.some((key) => commands.has(key)) ||
      sourceIds.some((key) => sources.has(key))
    )
      throw new Error(`Duplicate CmdFlow registration in ${extension.id}`);
    const owned = immutable(extension);
    extensions.set(owned.id, owned);
    for (const command of owned.commands ?? []) commands.set(command.id, command);
    for (const source of owned.sources ?? []) sources.set(source.id, source);
    for (const frame of [...main, ...actions]) {
      syncSources(frame);
      if (opened && owned.sources?.length) startSources(frame, false);
    }
    publish();
    diagnostic("extension-register", owned.id);
    let disposed = false;
    return () => {
      if (disposed || destroyed) return;
      disposed = true;
      extensions.delete(owned.id);
      for (const command of owned.commands ?? []) commands.delete(command.id);
      for (const source of owned.sources ?? []) sources.delete(source.id);
      for (const task of running.values()) {
        if (
          owned.commands?.some((command) => command === task.owner?.command) ||
          owned.sources?.some((source) => source === task.owner?.source)
        )
          task.controller.abort();
      }
      closeActionStack();
      for (const frame of main) syncSources(frame);
      publish();
      diagnostic("extension-dispose", owned.id);
    };
  }

  const api: CmdFlow<T> = {
    id,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribe(listener) {
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onEvent(listener) {
      if (destroyed) return () => {};
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    getContext: () => context,
    setContext(value) {
      if (destroyed || Object.is(context, value)) return;
      context = value;
      closeActionStack();
      for (const frame of main) startSources(frame);
      publish();
      diagnostic("context-change");
    },
    registerExtension,
    registerCommand: (command) =>
      registerExtension({ id: `command:${command.id}`, commands: [command] }),
    registerSource: (source) => registerExtension({ id: `source:${source.id}`, sources: [source] }),
    open() {
      if (destroyed) return;
      options.onOpenChange?.(true);
      if (!options.controlledOpen) openState(true);
    },
    close() {
      if (destroyed || !opened) return;
      const close = () => {
        options.onOpenChange?.(false);
        if (!options.controlledOpen) openState(false);
      };
      if (!requestDiscard(close)) close();
    },
    setOpen: openState,
    setQuery(query, address, composing = false) {
      const frame = find(address);
      if (!frame || destroyed) return;
      options.onQueryChange?.(query, { surface: frame.surface, frameId: frame.id });
      if (!options.controlledQuery || composing) queryState(query, frame, composing);
      else if (frame.composing) queryState(frame.committedQuery, frame, false);
    },
    syncQuery(query, address) {
      const frame = find(address);
      if (frame) queryState(query, frame, false);
    },
    moveActive(direction, address) {
      const frame = find(address);
      if (!frame || destroyed || frame.composing) return;
      const items = frame.snapshot.items;
      if (!items.length) return;
      const index = items.findIndex((item) => item.candidateId === frame.activeId);
      const next =
        direction === "first"
          ? 0
          : direction === "last"
            ? items.length - 1
            : direction === "next"
              ? (index + 1) % items.length
              : (index - 1 + items.length) % items.length;
      const item = items[next];
      if (item) api.setActive(item.candidateId, { surface: frame.surface, frameId: frame.id });
    },
    setActive(candidateId, address) {
      const frame = find(address);
      if (
        !frame ||
        destroyed ||
        !frame.snapshot.items.some((item) => item.candidateId === candidateId)
      )
        return;
      if (frame.activeId === candidateId) return;
      frame.activeId = candidateId;
      userNavigated = true;
      frame.navigationRevision += 1;
      effect("scroll", { frameId: frame.id });
      publishInteraction(frame);
    },
    toggleSelected(candidateId, address) {
      const frame = find(address);
      const item = frame?.snapshot.items.find((entry) => entry.candidateId === candidateId);
      if (
        !frame ||
        destroyed ||
        !item ||
        item.disabled ||
        frame.definition.selectionMode === "none" ||
        !frame.definition.selectionMode
      )
        return;
      frame.selectedIds = frame.selectedIds.includes(candidateId)
        ? frame.selectedIds.filter((entry) => entry !== candidateId)
        : frame.definition.selectionMode === "single"
          ? [candidateId]
          : [...frame.selectedIds, candidateId];
      userNavigated = true;
      frame.navigationRevision += 1;
      publishInteraction(frame);
    },
    openActions(candidateId, address) {
      const frame = find(address);
      if (!frame || destroyed || !opened) return;
      const chosen = candidateId ?? frame.activeId ?? undefined;
      const command = chosen ? frame.candidates.get(chosen) : undefined;
      const definitions = command ? actionDefinitions(command) : (frame.definition.actions ?? []);
      if (!definitions.length) return;
      userNavigated = true;
      frame.navigationRevision += 1;
      closeActionStack();
      const next = makeFrame(
        {
          id: `${frame.definition.id}:actions`,
          type: "list",
          title: "Actions",
          items: definitions,
          learnableQuery: false,
        },
        "actions",
      );
      next.actionOrigin = { frameId: frame.id, candidateId: chosen };
      actions.push(next);
      effect("focus", { frameId: next.id, target: "input" });
      publish();
      diagnostic("actions-open", chosen);
    },
    closeActions() {
      if (destroyed || !actions.length) return;
      closeActionStack();
      publish();
      diagnostic("actions-close");
    },
    push: (view, surface = "main") => pushFrame(view, surface),
    replace: (view, surface = "main") => pushFrame(view, surface, true),
    pop: (surface = actions.length ? "actions" : "main") => popFrame(surface),
    resetToRoot() {
      const reset = () => {
        closeActionStack();
        removeFrames("main", 1);
        effect("focus", { frameId: current("main").id, target: "input" });
        publish();
      };
      if (!requestDiscard(reset, [...main.slice(1), ...actions])) reset();
    },
    escape() {
      if (destroyed || !opened || current().composing) return;
      if (confirmation) {
        api.cancelConfirmation();
        return;
      }
      if (actions.length) {
        if (actions.length > 1) popFrame("actions");
        else api.closeActions();
        return;
      }
      if (main.length > 1) {
        popFrame("main");
        return;
      }
      if (current().query) api.setQuery("");
      else api.close();
    },
    async invoke(invocation = {}) {
      const frame = find(invocation.address);
      if (!frame || destroyed) return terminal("", "aborted");
      const candidateId = invocation.candidateId ?? frame.activeId ?? undefined;
      const action = resolveAction(frame, candidateId, invocation.actionId);
      if (!action) return terminal("", "disabled");
      return execute(
        frame,
        candidateId,
        action,
        invocation.confirmed,
        undefined,
        !!invocation.address,
      );
    },
    async confirm() {
      const work = confirmWork;
      if (!work) return;
      confirmation = null;
      confirmWork = null;
      publish();
      await work();
    },
    cancelConfirmation() {
      confirmation = null;
      confirmWork = null;
      effect("restore");
      publish();
    },
    async loadMore(sourceId, address) {
      const frame = find(address);
      const state = frame?.sources.get(sourceId);
      if (
        !frame ||
        !state ||
        state.snapshot.status === "loading" ||
        !state.snapshot.nextCursor ||
        destroyed
      )
        return;
      await runSource(frame, state, state.snapshot.nextCursor);
    },
    refresh(address) {
      const frame = find(address);
      if (!frame || destroyed) return;
      startSources(frame);
      publish();
    },
    setScrollAnchor(anchor, address) {
      const frame = find(address);
      if (!frame || destroyed) return;
      if (anchor && !frame.snapshot.items.some((item) => item.candidateId === anchor.candidateId))
        return;
      if (anchor && !Number.isFinite(anchor.offset)) return;
      if (
        frame.scrollAnchor?.candidateId === anchor?.candidateId &&
        frame.scrollAnchor?.offset === anchor?.offset
      )
        return;
      frame.scrollAnchor = anchor ? immutable(anchor) : null;
      frame.snapshot = Object.freeze({ ...frame.snapshot, scrollAnchor: frame.scrollAnchor });
      publish(false);
    },
    setField(fieldId, value, address) {
      const frame = find(address);
      if (
        !frame ||
        destroyed ||
        frame.definition.type !== "form" ||
        !frame.definition.fields?.some((field) => field.id === fieldId)
      )
        return;
      const errors = { ...frame.form.errors };
      delete errors[fieldId];
      frame.validation?.abort();
      frame.formVersion += 1;
      frame.form = immutable({
        ...frame.form,
        values: { ...frame.form.values, [fieldId]: value },
        errors,
        dirty: true,
      });
      publish();
    },
    async submitForm(address) {
      const frame = find(address);
      if (
        !frame ||
        destroyed ||
        frame.definition.type !== "form" ||
        !frame.definition.submit ||
        frame.form.submitting
      )
        return terminal("", "disabled");
      const controller = new AbortController();
      frame.validation = controller;
      const values = frame.form.values;
      const version = frame.formVersion;
      const originalSession = session;
      frame.form = immutable({ ...frame.form, submitting: true });
      publish();
      const input: ActionRunInput<T> = {
        ...evaluation(frame),
        values,
        signal: controller.signal,
        executionId: `${id}:validation:${++serial}`,
      };
      const errors: Record<string, string> = {};
      try {
        await abortable(
          Promise.all(
            (frame.definition.fields ?? []).map(async (field) => {
              const value = values[field.id] ?? "";
              if (
                field.required &&
                (value === "" || value === false || (Array.isArray(value) && !value.length))
              ) {
                errors[field.id] = `${field.label} is required`;
                return;
              }
              const error = await field.validate?.(value, input);
              if (error) errors[field.id] = error;
            }),
          ),
          controller.signal,
        );
      } catch (error) {
        errors._form = message(error);
      }
      if (frame.validation === controller) frame.validation = undefined;
      if (
        controller.signal.aborted ||
        !frameAlive(frame) ||
        originalSession !== session ||
        frame.formVersion !== version
      ) {
        if (frameAlive(frame)) {
          frame.form = immutable({ ...frame.form, submitting: false });
          publish();
        }
        return terminal(input.executionId, "aborted");
      }
      frame.form = immutable({ ...frame.form, errors, submitting: false });
      if (Object.keys(errors).length) {
        effect("focus", { frameId: frame.id, target: "form", fieldId: Object.keys(errors)[0] });
        effect("announce", { message: "Please correct the form errors" });
        publish();
        return terminal(input.executionId, "error", "Validation failed");
      }
      frame.form = immutable({ ...frame.form, submitting: true });
      publish();
      if (!frameAlive(frame) || originalSession !== session || frame.formVersion !== version) {
        if (frameAlive(frame)) {
          frame.form = immutable({ ...frame.form, submitting: false });
          publish();
        }
        return terminal(input.executionId, "aborted");
      }
      const result = await execute(frame, undefined, frame.definition.submit, false, version);
      if (frameAlive(frame)) {
        frame.form = immutable({ ...frame.form, submitting: false });
        publish();
      }
      return result;
    },
    getSafeDraft(address) {
      const frame = find(address);
      if (!frame) return Object.freeze({});
      const safe = new Set(
        (frame.definition.fields ?? [])
          .filter((field) => field.type !== "password" && !field.sensitive)
          .map((field) => field.id),
      );
      return immutable(
        Object.fromEntries(Object.entries(frame.form.values).filter(([key]) => safe.has(key))),
      );
    },
    restoreDraft(values, address) {
      const frame = find(address);
      if (!frame || destroyed) return;
      const safe = new Set(
        (frame.definition.fields ?? [])
          .filter((field) => field.type !== "password" && !field.sensitive)
          .map((field) => field.id),
      );
      frame.validation?.abort();
      frame.formVersion += 1;
      frame.form = immutable({
        ...frame.form,
        values: {
          ...frame.form.values,
          ...Object.fromEntries(Object.entries(values).filter(([key]) => safe.has(key))),
        },
        dirty: true,
      });
      publish();
    },
    explainRanking(address) {
      return find(address)?.rankExplanations ?? Object.freeze([]);
    },
    async resetRanking(selector = { type: "all", subjectKey: rankingScope.subjectKey }) {
      rankingWriteGeneration += 1;
      await rankingStore.reset(selector);
      releaseRanking();
      await hydrateRanking();
      diagnostic("ranking-reset");
    },
    getDomEffects: () => Object.freeze(effects.slice()),
    acknowledgeDomEffects(ids) {
      const acknowledged = new Set(ids);
      effects = effects.filter((entry) => !acknowledged.has(entry.id));
    },
    send(event) {
      switch (event.type) {
        case "OPEN":
          api.open();
          break;
        case "CLOSE":
          api.close();
          break;
        case "INPUT_CHANGED":
          api.setQuery(event.value, event.address, event.phase === "composing");
          break;
        case "MOVE_ACTIVE":
          api.moveActive(event.direction, event.address);
          break;
        case "SET_ACTIVE":
          api.setActive(event.candidateId, event.address);
          break;
        case "OPEN_ACTIONS":
          api.openActions(event.candidateId, event.address);
          break;
        case "CLOSE_ACTIONS":
          api.closeActions();
          break;
        case "POP_VIEW":
          api.pop(event.surface);
          break;
        case "INVOKE":
          void api.invoke(event.options);
          break;
      }
    },
    destroy() {
      if (destroyed) return;
      for (const frame of [...main, ...actions]) disposeFrame(frame);
      for (const task of running.values()) task.controller.abort();
      unsubscribeContext?.();
      unsubscribeRanking?.();
      opened = false;
      destroyed = true;
      effects = [];
      publish(false);
      listeners.clear();
      eventListeners.clear();
    },
  };
  main.push(makeFrame(immutable(root), "main"));
  for (const command of options.commands ?? []) {
    if (commands.has(command.id)) throw new Error(`Duplicate CmdFlow command: ${command.id}`);
    commands.set(command.id, immutable(command));
  }
  for (const source of options.sources ?? []) {
    validateSourceId(source.id);
    if (sources.has(source.id)) throw new Error(`Duplicate CmdFlow source: ${source.id}`);
    sources.set(source.id, immutable(source));
  }
  syncSources(current("main"));
  publish();
  serverSnapshot = snapshot;
  const unsubscribeContext = contextStore?.subscribe(() =>
    api.setContext(contextStore.getSnapshot()),
  );
  const unsubscribeRanking = rankingStore.subscribe?.(() => {
    void hydrateRanking();
  });
  void hydrateRanking();
  return api;
}
