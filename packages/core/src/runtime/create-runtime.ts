import type {
  CmdFlowActionDefinition as ActionDefinition,
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
import type { CmdFlowSnapshot } from "../contracts/snapshots.js";
import { createRankingSurfaceId, immutable } from "../identity.js";
import { createMemoryRankingStore, deriveRankingQueryKey, normalizeQueryV1 } from "../ranking.js";
import type { RankingScope } from "../ranking-types.js";
import { ActionResolver } from "./action-resolver.js";
import {
  commandFromAction,
  normalizeCommandDefinition,
  normalizeExtensionDefinition,
  normalizeResultSource,
  normalizeViewDefinition,
} from "./definitions.js";
import { createExecutionRuntime, type ExecutionFeedback } from "./execution-runtime.js";
import { createFormRuntime } from "./form-runtime.js";
import { createFrameState } from "./frame.js";
import { FrameProjector } from "./frame-projector.js";
import { createNavigationRuntime } from "./navigation-runtime.js";
import { createRuntimeSnapshot } from "./snapshot.js";
import { createSourceRuntime } from "./source-runtime.js";
import type { Frame, RunningExecution } from "./state.js";
import { isContextStore, errorMessage as message, terminalResult as terminal } from "./utils.js";

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
  let rankingReady = false;
  let rankingGeneration = 0;
  let rankingWriteGeneration = 0;
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
  const actionResolver = new ActionResolver<T, TData>({
    getContext: () => context,
    getMainFrames: () => main,
    diagnostic,
  });
  const frameProjector = new FrameProjector<T, TData>({
    actions: actionResolver,
    commands: () => commands.values(),
    scope,
    now: () => clock.now(),
    diagnostic,
  });
  const buildFrame = (frame: Frame<T, TData>) => frameProjector.project(frame, frame === main[0]);
  function publishInteraction(frame: Frame<T, TData>) {
    actionResolver.refreshInteraction(frame);
    for (const actionFrame of actions)
      if (actionFrame.actionOrigin?.frameId === frame.id)
        actionResolver.refreshInteraction(actionFrame);
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
          return [frame, await rankingStore.load({ scope: frameScope, now: clock.now() })] as const;
        }),
      );
      if (destroyed || generation !== rankingGeneration) return;
      for (const [frame, profile] of loaded) {
        if (frame.rankingLocked) {
          frame.deferredRankingProfile = profile;
        } else {
          frame.rankingProfile = profile;
          frame.deferredRankingProfile = undefined;
          frame.activeId = null;
        }
      }
    } catch (error) {
      diagnostic("ranking-storage-error", undefined, message(error));
    }
    if (destroyed || generation !== rankingGeneration) return;
    rankingReady = true;
    publish();
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
    try {
      const policy = typeof configured === "function" ? await configured(scope(frame)) : configured;
      const key = await deriveRankingQueryKey(query, scope(frame), policy);
      // A later publish (including Escape) would use this key even if we didn't publish here.
      // Leave the ranking inputs untouched once navigation has locked the current query.
      if (
        !key ||
        !frameAlive(frame) ||
        generation !== frame.queryKeyGeneration ||
        query !== frame.query ||
        frame.composing ||
        frame.rankingLocked
      )
        return;
      frame.queryKey = key;
      frame.activeId = null;
      publish();
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
  function releaseRanking(frames: readonly Frame<T, TData>[] = [...main, ...actions]) {
    for (const frame of frames) {
      frame.rankingLocked = false;
      if (frame.deferredRankingProfile) {
        frame.rankingProfile = frame.deferredRankingProfile;
        frame.deferredRankingProfile = undefined;
      }
    }
  }
  function resetActiveItems() {
    for (const frame of [...main, ...actions]) frame.activeId = null;
  }
  const navigationRuntime = createNavigationRuntime<T, TData>({
    mainFrames: main,
    actionFrames: actions,
    isDestroyed: () => destroyed,
    createFrame: makeFrame,
    disposeFrame,
    requestDiscard,
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
    if (value) {
      releaseRanking();
      resetActiveItems();
    }
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
    const wasComposing = frame.composing;
    const changed = frame.query !== query;
    const committed = !composing && (changed || wasComposing);
    frame.query = query;
    frame.composing = composing;
    if (!composing) frame.committedQuery = query;
    if (committed) {
      frame.activeId = null;
      frame.scrollAnchor = null;
    }
    if (frame.surface === "main" && actions.length) closeActionStack();
    if (!composing) {
      releaseRanking([frame]);
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
    const definitions = command
      ? actionResolver.definitions(command)
      : (frame.definition.actions ?? []);
    if (actionId)
      return (
        definitions.find((action) => action.id === actionId) ??
        (frame.definition.submit?.id === actionId ? frame.definition.submit : undefined)
      );
    const snapshots = actionResolver.snapshots(
      definitions,
      actionResolver.evaluate(frame, candidateId),
    );
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
    evaluate: (frame, candidateId) => actionResolver.evaluate(frame, candidateId),
    snapshotAction: (action, input) => actionResolver.snapshot(action, input),
    applyOutcome,
    publish,
    diagnostic,
    effect,
    onExecutionStart: (origin) => {
      origin.rankingLocked = true;
    },
    recordSuccessfulUse,
  });

  const formRuntime = createFormRuntime<T, TData>({
    findFrame: find,
    isDestroyed: () => destroyed,
    isFrameAlive: frameAlive,
    getSession: () => session,
    createValidationId: () => `${id}:validation:${++serial}`,
    evaluate: (frame) => actionResolver.evaluate(frame),
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
              ? Math.min(index + 1, items.length - 1)
              : Math.max(index - 1, 0);
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
      frame.rankingLocked = true;
      if (frame.activeId === candidateId) return;
      frame.activeId = candidateId;
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
      frame.rankingLocked = true;
      publishInteraction(frame);
    },
    openActions(candidateId, address) {
      const frame = find(address);
      if (!frame || destroyed || !opened) return;
      const chosen = candidateId ?? frame.activeId ?? undefined;
      const command = chosen ? frame.candidates.get(chosen) : undefined;
      const definitions = command
        ? actionResolver.definitions(command)
        : (frame.definition.actions ?? []);
      if (!definitions.length) return;
      frame.rankingLocked = true;
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
      const frame = current();
      if (!frame.query) {
        api.close();
        return;
      }
      const beforeQueryChange = revision;
      effect("focus", { frameId: frame.id, target: "input" });
      api.setQuery("");
      if (revision === beforeQueryChange) publish(false);
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
