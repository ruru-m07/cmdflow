import type {
  CmdFlowActionDefinition as ActionDefinition,
  CmdFlowActionEvaluation as ActionEvaluation,
  CmdFlowActionOutcome as ActionOutcome,
  CmdFlowCommandDefinition as CommandDefinition,
  CmdFlowExtensionDefinition as ExtensionDefinition,
  CmdFlowResultSource as ResultSource,
  CmdFlowViewDefinition as ViewDefinition,
} from "../contracts/definitions.js";
import type {
  CmdFlow,
  CmdFlowOptions,
  CmdFlowDiagnosticEvent as DiagnosticEvent,
  CmdFlowDomEffect as DomEffect,
} from "../contracts/flow.js";
import type {
  CandidateId,
  CmdFlowSurface as Surface,
  CmdFlowSurfaceAddress as SurfaceAddress,
} from "../contracts/primitives.js";
import type {
  CmdFlowActionSnapshot as ActionSnapshot,
  CmdFlowSnapshot,
  CmdFlowResolvedItem as ResolvedItem,
} from "../contracts/snapshots.js";
import { createCandidateId, createRankingSurfaceId, immutable } from "../identity.js";
import {
  createMemoryRankingStore,
  deriveRankingQueryKey,
  normalizeQueryV1,
  rankItems,
} from "../ranking.js";
import type { RankingProfile, RankingScope } from "../ranking-types.js";
import {
  commandFromAction,
  normalizeCommandDefinition,
  normalizeExtensionDefinition,
  normalizeResultSource,
  normalizeViewDefinition,
} from "./definitions.js";
import { createExecutionRuntime, type ExecutionFeedback } from "./execution-runtime.js";
import { createFormRuntime } from "./form-runtime.js";
import { createFrameState, createViewSnapshot } from "./frame.js";
import { createNavigationRuntime } from "./navigation-runtime.js";
import { createRuntimeSnapshot } from "./snapshot.js";
import { createSourceRuntime } from "./source-runtime.js";
import type { Frame, RunningExecution } from "./state.js";
import {
  evaluateAvailability as available,
  isContextStore,
  errorMessage as message,
  terminalResult as terminal,
} from "./utils.js";

export function createCmdFlowRuntime<T = Record<string, never>, TData = unknown>(
  options: CmdFlowOptions<T, TData> = {},
): CmdFlow<T, TData> {
  const id = options.id ?? "cmdflow";
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new TypeError("CmdFlowOptions.id must be a non-empty string");
  }
  if (options.initialOpen !== undefined && typeof options.initialOpen !== "boolean") {
    throw new TypeError("CmdFlowOptions.initialOpen must be a boolean");
  }
  if (options.initialQuery !== undefined && typeof options.initialQuery !== "string") {
    throw new TypeError("CmdFlowOptions.initialQuery must be a string");
  }
  const clock = options.clock ?? { now: () => Date.now() };
  // Persisted idempotency receipts outlive flows and page reloads. These are operation
  // identifiers, not security tokens; never derive them from query or application data.
  const executionNamespace = `${clock.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  const contextStore = isContextStore<T>(options.context) ? options.context : undefined;
  let context = contextStore ? contextStore.getSnapshot() : ((options.context ?? {}) as T);
  const root = options.root ?? { id: "root", type: "list", title: "Commands" };
  const commands = new Map<string, CommandDefinition<T, TData>>();
  const sources = new Map<string, ResultSource<T, TData>>();
  const extensions = new Map<string, ExtensionDefinition<T, TData>>();
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(event: DiagnosticEvent) => void>();
  const main: Frame<T, TData>[] = [];
  const actions: Frame<T, TData>[] = [];
  let opened = options.initialOpen ?? false;
  let destroyed = false;
  let session = opened ? 1 : 0;
  let revision = 0;
  let serial = 0;
  let effectSerial = 0;
  let effects: DomEffect[] = [];
  let snapshot!: CmdFlowSnapshot<TData>;
  let serverSnapshot: CmdFlowSnapshot<TData>;
  const profiles = new Map<string, RankingProfile>();
  const deferredProfiles = new Map<string, RankingProfile>();
  let rankingReady = false;
  let rankingGeneration = 0;
  let rankingWriteGeneration = 0;
  let userNavigated = false;
  let externalStoresActive = false;
  let unsubscribeContext: (() => void) | undefined;
  let unsubscribeRanking: (() => void) | undefined;
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
  function activateExternalStores() {
    if (destroyed || externalStoresActive) return;
    externalStoresActive = true;
    unsubscribeContext = contextStore?.subscribe(() => api.setContext(contextStore.getSnapshot()));
    unsubscribeRanking = rankingStore.subscribe?.(() => {
      void hydrateRanking();
    });
    if (contextStore) api.setContext(contextStore.getSnapshot());
    if (opened) {
      for (const frame of main) void deriveQuery(frame);
      startSources(current("main"), false);
    }
    void hydrateRanking();
  }
  function reconcileExternalStores() {
    const shouldBeActive = !destroyed && (opened || listeners.size > 0);
    if (shouldBeActive) {
      activateExternalStores();
      return;
    }
    if (!externalStoresActive) return;
    externalStoresActive = false;
    unsubscribeContext?.();
    unsubscribeRanking?.();
    unsubscribeContext = undefined;
    unsubscribeRanking = undefined;
    rankingGeneration += 1;
  }
  function current(surface?: Surface): Frame<T, TData> {
    const stack =
      surface === "main" ? main : surface === "actions" ? actions : actions.length ? actions : main;
    const frame = stack.at(-1);
    if (!frame) throw new Error("The requested CmdFlow surface is not open");
    return frame;
  }
  function find(address?: SurfaceAddress): Frame<T, TData> | undefined {
    if (!address) return current();
    return (address.surface === "main" ? main : actions).find(
      (frame) => frame.id === address.frameId,
    );
  }
  function frameAlive(frame: Frame<T, TData>) {
    return !destroyed && (main.includes(frame) || actions.includes(frame));
  }
  function scope(frame: Frame<T, TData>): RankingScope {
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
  function makeFrame(definition: ViewDefinition<T, TData>, surface: Surface): Frame<T, TData> {
    return createFrameState(`${id}:frame:${++serial}`, definition, surface);
  }
  function evaluation(
    frame: Frame<T, TData>,
    candidateId?: CandidateId,
  ): ActionEvaluation<T, TData> {
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
    action: ActionDefinition<T, TData>,
    input: ActionEvaluation<T, TData>,
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
        hasChildren: action.type === "submenu" && action.actions.length > 0,
      });
    } catch (error) {
      diagnostic("predicate-error", action.id, message(error));
      return null;
    }
  }
  function actionDefinitions(
    command: CommandDefinition<T, TData>,
  ): readonly ActionDefinition<T, TData>[] {
    return command.actions ?? (command.action ? [command.action] : []);
  }
  function actionSnapshots(
    definitions: readonly ActionDefinition<T, TData>[],
    input: ActionEvaluation<T, TData>,
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
  function buildFrame(frame: Frame<T, TData>) {
    const candidates = new Map<CandidateId, CommandDefinition<T, TData>>();
    const resolved: ResolvedItem<TData>[] = [];
    const collect = (
      sourceId: string,
      definitions: Iterable<CommandDefinition<T, TData>>,
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
      view: createViewSnapshot(frame.definition),
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
  function refreshInteraction(frame: Frame<T, TData>) {
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
    const evaluate = (candidateId?: CandidateId): ActionEvaluation<T, TData> => ({
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
  function publishInteraction(frame: Frame<T, TData>) {
    refreshInteraction(frame);
    for (const actionFrame of actions)
      if (actionFrame.actionOrigin?.frameId === frame.id) refreshInteraction(actionFrame);
    publish(false);
  }
  function publish(rebuild = true) {
    if (destroyed && snapshot?.destroyed) return;
    if (rebuild) for (const frame of [...main, ...actions]) buildFrame(frame);
    snapshot = createRuntimeSnapshot({
      revision: ++revision,
      open: opened,
      sessionId: session,
      mainFrames: main,
      actionFrames: actions,
      executions: executionRuntime.getExecutions(),
      confirmation: executionRuntime.getConfirmation(),
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

  const sourceRuntime = createSourceRuntime<T, TData>({
    getContext: () => context,
    getOpened: () => opened,
    getSession: () => session,
    getSources: () => sources,
    isFrameAlive: frameAlive,
    isRootFrame: (frame) => frame === main[0],
    getScope: scope,
    publish,
    diagnostic,
    effect,
  });
  const abortSource = sourceRuntime.abort;
  const syncSources = sourceRuntime.sync;
  const startSources = sourceRuntime.start;
  const runSource = sourceRuntime.loadMore;

  function disposeFrame(frame: Frame<T, TData>) {
    frame.validation?.abort();
    for (const state of frame.sources.values()) abortSource(state);
    executionRuntime.abortFrame(frame);
    effects = effects.filter((entry) => entry.frameId !== frame.id);
  }
  function validateSourceId(sourceId: string) {
    if (sourceId === "registry" || sourceId.startsWith("view:"))
      throw new Error(`Reserved CmdFlow source namespace: ${sourceId}`);
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
  async function deriveQuery(frame: Frame<T, TData>) {
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
  function requestDiscard(
    work: () => void,
    affected: readonly Frame<T, TData>[] = [...main, ...actions],
  ): boolean {
    const dirty = affected.some((frame) => frame.form.dirty);
    if (!dirty) return false;
    executionRuntime.requestDiscard(() => {
      for (const frame of affected) frame.form = immutable({ ...frame.form, dirty: false });
      work();
    });
    return true;
  }
  function releaseRanking() {
    userNavigated = false;
    for (const [key, profile] of deferredProfiles) profiles.set(key, profile);
    deferredProfiles.clear();
  }
  const navigationRuntime = createNavigationRuntime<T, TData>({
    mainFrames: main,
    actionFrames: actions,
    isDestroyed: () => destroyed,
    createFrame: makeFrame,
    disposeFrame,
    requestDiscard,
    releaseRanking,
    deriveQuery: (frame) => {
      void deriveQuery(frame);
    },
    hydrateRanking: () => {
      void hydrateRanking();
    },
    startSources,
    effect,
    publish,
    diagnostic,
  });
  const closeActionStack = navigationRuntime.closeActionStack;
  const removeFrames = navigationRuntime.removeFrames;
  const pushFrame = navigationRuntime.push;
  const popFrame = navigationRuntime.pop;

  function openState(value: boolean) {
    if (destroyed || value === opened) return;
    const storesWereActive = externalStoresActive;
    opened = value;
    session += 1;
    if (value) releaseRanking();
    reconcileExternalStores();
    if (value) {
      if (storesWereActive) {
        for (const frame of main) void deriveQuery(frame);
        void hydrateRanking();
        startSources(current("main"), false);
      }
      effect("focus", {
        frameId: current().id,
        target: current().definition.type === "form" ? "form" : "input",
      });
    } else {
      closeActionStack();
      for (const frame of main) {
        frame.validation?.abort();
        for (const state of frame.sources.values()) abortSource(state);
      }
      executionRuntime.abortOriginBound();
      executionRuntime.clearConfirmation();
      effect("restore");
    }
    publish();
    reconcileExternalStores();
    diagnostic(value ? "open" : "close");
  }
  function queryState(query: string, frame: Frame<T, TData>, composing: boolean) {
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

  function resolveAction(
    frame: Frame<T, TData>,
    candidateId?: CandidateId,
    actionId?: string,
  ): ActionDefinition<T, TData> | undefined {
    const command = candidateId ? frame.candidates.get(candidateId) : undefined;
    // `command.action` is the explicit direct-invocation behavior. Contextual action arrays still
    // use their primary designation when a command has no default action.
    if (command?.action && !actionId) {
      return command.action;
    }
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
  function applyOutcome(outcome: ActionOutcome<T, TData> | void, task: RunningExecution<T, TData>) {
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
      outcome.target === "origin"
        ? task.frame.actionOrigin
          ? "main"
          : task.frame.surface
        : (outcome.target ?? task.frame.surface);
    if (outcome.type === "pop-view") popFrame(surface);
    else pushFrame(outcome.view, surface, outcome.type === "replace-view");
  }

  function recordSuccessfulUse(feedback: ExecutionFeedback<T, TData>): void {
    const feedbackScope = scope(feedback.frame);
    const feedbackGeneration = rankingWriteGeneration;
    const occurredAt = clock.now();
    // Storage and fingerprinting must never delay the command's UI outcome.
    void (async () => {
      try {
        const configured = options.ranking?.queryPolicy ?? { strategy: "plain" as const };
        const policy =
          typeof configured === "function" ? await configured(feedbackScope) : configured;
        const queryKey =
          feedback.queryKey ?? (await deriveRankingQueryKey(feedback.query, feedbackScope, policy));
        if (destroyed || feedbackGeneration !== rankingWriteGeneration) return;
        await rankingStore.commit({
          operationId: feedback.executionId,
          candidateId: feedback.candidateId,
          scope: feedbackScope,
          queryKey,
          occurredAt,
        });
        await hydrateRanking();
        diagnostic("ranking-feedback", feedback.candidateId);
      } catch (error) {
        diagnostic("ranking-storage-error", feedback.candidateId, message(error));
      }
    })();
  }

  const executionRuntime = createExecutionRuntime<T, TData>({
    createExecutionId: () => `${id}:${executionNamespace}:execution:${++serial}`,
    createConfirmationId: () => `${id}:confirm:${++serial}`,
    getSession: () => session,
    isDestroyed: () => destroyed,
    isFrameAlive: frameAlive,
    getMainFrames: () => main,
    getActionFrames: () => actions,
    evaluate: evaluation,
    snapshotAction: actionSnapshot,
    applyOutcome,
    publish,
    diagnostic,
    effect,
    onExecutionStart: () => {
      userNavigated = true;
    },
    recordSuccessfulUse,
  });

  const formRuntime = createFormRuntime<T, TData>({
    findFrame: find,
    isDestroyed: () => destroyed,
    isFrameAlive: frameAlive,
    getSession: () => session,
    createValidationId: () => `${id}:validation:${++serial}`,
    evaluate: evaluation,
    executeSubmit: (frame, action, submittedVersion) =>
      executionRuntime.execute(frame, undefined, action, { submittedVersion }),
    publish,
    effect,
  });

  function ensureMutable() {
    if (destroyed) throw new Error("This CmdFlow instance has been destroyed");
  }
  function registerExtension(extension: ExtensionDefinition<T, TData>): () => void {
    ensureMutable();
    const owned = normalizeExtensionDefinition(extension);
    const commandIds = (owned.commands ?? []).map((command) => command.id);
    const sourceIds = (owned.sources ?? []).map((source) => source.id);
    for (const sourceId of sourceIds) validateSourceId(sourceId);
    if (
      extensions.has(owned.id) ||
      new Set(commandIds).size !== commandIds.length ||
      new Set(sourceIds).size !== sourceIds.length ||
      commandIds.some((key) => commands.has(key)) ||
      sourceIds.some((key) => sources.has(key))
    )
      throw new Error(`Duplicate CmdFlow registration in ${owned.id}`);
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
      executionRuntime.abortOwned(owned.commands ?? [], owned.sources ?? []);
      closeActionStack();
      for (const frame of main) syncSources(frame);
      publish();
      diagnostic("extension-dispose", owned.id);
    };
  }

  const api: CmdFlow<T, TData> = {
    id,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribe(listener) {
      if (destroyed) return () => {};
      listeners.add(listener);
      reconcileExternalStores();
      return () => {
        listeners.delete(listener);
        reconcileExternalStores();
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
          items: definitions.map(commandFromAction),
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
      if (executionRuntime.getConfirmation()) {
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
      return executionRuntime.execute(frame, candidateId, action, {
        allowUi: !!invocation.address,
      });
    },
    confirm: () => executionRuntime.confirm(),
    cancelConfirmation: () => executionRuntime.cancelConfirmation(),
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
    setField: formRuntime.setField,
    submitForm: formRuntime.submit,
    getSafeDraft: formRuntime.getSafeDraft,
    restoreDraft: formRuntime.restoreDraft,
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
      executionRuntime.abortAll();
      executionRuntime.clearConfirmation();
      opened = false;
      destroyed = true;
      reconcileExternalStores();
      effects = [];
      publish(false);
      listeners.clear();
      eventListeners.clear();
    },
  };
  for (const [index, command] of (options.commands ?? []).entries()) {
    const normalizedCommand = normalizeCommandDefinition(command, `options.commands[${index}]`);
    if (commands.has(normalizedCommand.id)) {
      throw new Error(`Duplicate CmdFlow command: ${normalizedCommand.id}`);
    }
    commands.set(normalizedCommand.id, normalizedCommand);
  }
  for (const [index, source] of (options.sources ?? []).entries()) {
    const normalizedSource = normalizeResultSource(source, `options.sources[${index}]`);
    validateSourceId(normalizedSource.id);
    if (sources.has(normalizedSource.id)) {
      throw new Error(`Duplicate CmdFlow source: ${normalizedSource.id}`);
    }
    sources.set(normalizedSource.id, normalizedSource);
  }
  const normalizedRoot = normalizeViewDefinition(root, "options.root");
  const rootFrame = makeFrame(normalizedRoot, "main");
  rootFrame.query = options.initialQuery ?? "";
  rootFrame.committedQuery = rootFrame.query;
  main.push(rootFrame);
  syncSources(current("main"));
  publish();
  serverSnapshot = snapshot;
  return api;
}
