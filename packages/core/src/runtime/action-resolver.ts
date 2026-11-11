import type {
  CmdFlowActionDefinition as ActionDefinition,
  CmdFlowActionEvaluation as ActionEvaluation,
  CmdFlowCommandDefinition as CommandDefinition,
} from "../contracts/definitions.js";
import type { CandidateId } from "../contracts/primitives.js";
import type { CmdFlowActionSnapshot as ActionSnapshot } from "../contracts/snapshots.js";
import { immutable } from "../identity.js";
import type { Frame } from "./state.js";
import { errorMessage, evaluateAvailability } from "./utils.js";

interface ActionResolverOptions<TContext, TData> {
  getContext(): TContext;
  getMainFrames(): readonly Frame<TContext, TData>[];
  diagnostic(type: string, id?: string, detail?: string): void;
}

/** Owns action evaluation and projection without owning navigation or execution state. */
export class ActionResolver<TContext, TData = unknown> {
  constructor(private readonly options: ActionResolverOptions<TContext, TData>) {}

  definitions(
    command: CommandDefinition<TContext, TData>,
  ): readonly ActionDefinition<TContext, TData>[] {
    return command.actions ?? (command.action ? [command.action] : []);
  }

  evaluate(
    frame: Frame<TContext, TData>,
    candidateId?: CandidateId,
  ): ActionEvaluation<TContext, TData> {
    const origin = frame.actionOrigin;
    const actual = origin
      ? (this.options.getMainFrames().find((entry) => entry.id === origin.frameId) ?? frame)
      : frame;
    const active = origin?.candidateId ?? candidateId;
    return {
      appContext: this.options.getContext(),
      frame: actual.snapshot,
      surface: frame.surface,
      item: active
        ? (actual.snapshot.items.find((item) => item.candidateId === active) ?? null)
        : null,
      selection: actual.snapshot.selectedIds,
    };
  }

  snapshot(
    action: ActionDefinition<TContext, TData>,
    input: ActionEvaluation<TContext, TData>,
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
        ...evaluateAvailability(action.enabled?.(input)),
        priority: action.priority ?? "auxiliary",
        hasChildren: action.type === "submenu" && action.actions.length > 0,
      });
    } catch (error) {
      this.options.diagnostic("predicate-error", action.id, errorMessage(error));
      return null;
    }
  }

  snapshots(
    definitions: readonly ActionDefinition<TContext, TData>[],
    input: ActionEvaluation<TContext, TData>,
  ): readonly ActionSnapshot[] {
    const result = definitions
      .map((action) => this.snapshot(action, input))
      .filter((item): item is ActionSnapshot => !!item);
    const priorities = new Set<string>();
    let normalized = result.map((item) => {
      if (item.priority === "auxiliary") return item;
      if (priorities.has(item.priority)) {
        this.options.diagnostic("duplicate-priority", item.id);
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

  /** Retains item identity while reevaluating context-sensitive actions. */
  refreshInteraction(frame: Frame<TContext, TData>): void {
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
    const actual = origin
      ? (this.options.getMainFrames().find((entry) => entry.id === origin.frameId) ?? frame)
      : frame;
    const lookup = new Map(actual.snapshot.items.map((item) => [item.candidateId, item]));
    const evaluate = (candidateId?: CandidateId): ActionEvaluation<TContext, TData> => ({
      appContext: this.options.getContext(),
      frame: actual.snapshot,
      surface: frame.surface,
      item: lookup.get(origin?.candidateId ?? (candidateId as CandidateId)) ?? null,
      selection: actual.snapshot.selectedIds,
    });
    let changedItems = false;
    const items = previous.items.map((item) => {
      const command = frame.candidates.get(item.candidateId);
      if (!command) return item;
      const definitions = this.definitions(command);
      if (!definitions.some((action) => action.visible || action.enabled)) return item;
      const nextActions = this.snapshots(definitions, evaluate(item.candidateId));
      if (sameSnapshots(item.actions, nextActions)) return item;
      changedItems = true;
      return Object.freeze({ ...item, actions: nextActions });
    });
    const active = frame.activeId ? frame.candidates.get(frame.activeId) : undefined;
    const nextActions = active
      ? (items.find((item) => item.candidateId === frame.activeId)?.actions ?? [])
      : this.snapshots(frame.definition.actions ?? [], evaluate());
    frame.snapshot = Object.freeze({
      ...frame.snapshot,
      items: changedItems ? Object.freeze(items) : previous.items,
      actions: sameSnapshots(previous.actions, nextActions) ? previous.actions : nextActions,
    });
  }
}

function sameSnapshots(left: readonly ActionSnapshot[], right: readonly ActionSnapshot[]): boolean {
  return (
    left.length === right.length &&
    left.every((action, index) => {
      const other = right[index];
      return (
        !!other &&
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
