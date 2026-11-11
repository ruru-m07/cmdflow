import type { CmdFlowCommandDefinition as CommandDefinition } from "../contracts/definitions.js";
import type { CandidateId } from "../contracts/primitives.js";
import type { CmdFlowResolvedItem as ResolvedItem } from "../contracts/snapshots.js";
import { createCandidateId, immutable } from "../identity.js";
import { rankItems } from "../ranking.js";
import type { RankingScope } from "../ranking-types.js";
import type { ActionResolver } from "./action-resolver.js";
import { createViewSnapshot } from "./frame.js";
import type { Frame } from "./state.js";
import { errorMessage, evaluateAvailability } from "./utils.js";

interface FrameProjectorOptions<TContext, TData> {
  actions: ActionResolver<TContext, TData>;
  commands(): Iterable<CommandDefinition<TContext, TData>>;
  scope(frame: Frame<TContext, TData>): RankingScope;
  now(): number;
  diagnostic(type: string, id?: string, detail?: string): void;
}

/** Converts mutable frame state into the immutable snapshot consumed by renderers. */
export class FrameProjector<TContext, TData = unknown> {
  constructor(private readonly options: FrameProjectorOptions<TContext, TData>) {}

  project(frame: Frame<TContext, TData>, includeRegistry: boolean): void {
    const candidates = new Map<CandidateId, CommandDefinition<TContext, TData>>();
    const resolved: ResolvedItem<TData>[] = [];
    const collect = (
      sourceId: string,
      definitions: Iterable<CommandDefinition<TContext, TData>>,
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
          ? this.options.actions.evaluate(frame, candidateId)
          : { ...this.options.actions.evaluate(frame), item: preliminary };
        try {
          if (command.visible && !command.visible(input)) continue;
          const disabled =
            command.disabled === true
              ? { disabled: true }
              : typeof command.disabled === "object"
                ? { disabled: true, disabledReason: command.disabled.reason }
                : evaluateAvailability(command.enabled?.(input));
          const actionDefinitions = this.options.actions.definitions(command);
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
            actions: this.options.actions.snapshots(actionDefinitions, input),
          });
          candidates.set(candidateId, command);
          resolved.push(item);
          if (
            !command.visible &&
            !command.enabled &&
            !actionDefinitions.some((action) => action.visible || action.enabled)
          ) {
            frame.staticItems.set(candidateId, { command, sourcePriority, item });
          } else {
            frame.staticItems.delete(candidateId);
          }
        } catch (error) {
          this.options.diagnostic("command-error", command.id, errorMessage(error));
        }
      }
    };

    if (includeRegistry) collect("registry", this.options.commands());
    collect(`view:${frame.definition.id}`, frame.definition.items ?? []);
    for (const [sourceId, state] of frame.sources) {
      collect(sourceId, state.items.values(), state.definition.sourcePriority ?? 0);
    }
    for (const candidateId of frame.staticItems.keys()) {
      if (!candidates.has(candidateId)) frame.staticItems.delete(candidateId);
    }

    const scope = this.options.scope(frame);
    const ranked = rankItems(resolved, {
      query: frame.query,
      scope,
      profile: frame.rankingProfile,
      now: this.options.now(),
      queryKey: frame.queryKey,
    });
    frame.rankExplanations = ranked.explanations;
    frame.candidates = candidates;
    const previousIndex = frame.snapshot.items.findIndex(
      (entry) => entry.candidateId === frame.activeId,
    );
    if (!ranked.items.some((entry) => entry.candidateId === frame.activeId)) {
      frame.activeId =
        ranked.items[Math.max(0, Math.min(previousIndex, ranked.items.length - 1))]?.candidateId ??
        null;
    }
    frame.selectedIds = frame.selectedIds.filter((entry) =>
      ranked.items.some((item) => item.candidateId === entry),
    );
    const active = frame.activeId ? candidates.get(frame.activeId) : undefined;
    const definitions = active
      ? this.options.actions.definitions(active)
      : (frame.definition.actions ?? []);
    frame.snapshot = immutable({
      id: frame.id,
      surface: frame.surface,
      view: createViewSnapshot(frame.definition),
      query: frame.query,
      composing: frame.composing,
      activeId: frame.activeId,
      selectedIds: frame.selectedIds,
      items: ranked.items,
      sources: [...frame.sources.values()].map((state) => state.snapshot),
      actions: [],
      scrollAnchor: frame.scrollAnchor,
      form: frame.form,
    });
    frame.snapshot = immutable({
      ...frame.snapshot,
      actions: this.options.actions.snapshots(
        definitions,
        this.options.actions.evaluate(frame, frame.activeId ?? undefined),
      ),
    });
  }
}
