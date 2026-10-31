import type { CmdFlowViewDefinition } from "../contracts/definitions.js";
import type { CmdFlowSurface } from "../contracts/primitives.js";
import type { CmdFlowFrameSnapshot, CmdFlowViewSnapshot } from "../contracts/snapshots.js";
import { immutable } from "../identity.js";
import { initialFieldValue } from "./form.js";
import type { Frame } from "./state.js";

export function createViewSnapshot<TContext, TData>(
  definition: CmdFlowViewDefinition<TContext, TData>,
): CmdFlowViewSnapshot {
  return immutable({
    id: definition.id,
    type: definition.type,
    title: definition.title ?? definition.id,
    description: definition.description,
    renderer: definition.renderer,
    selectionMode: definition.selectionMode ?? "none",
    fields: (definition.fields ?? []).map(({ validate: _validate, ...field }) => field),
  });
}

export function createFrameState<TContext, TData>(
  frameId: string,
  definition: CmdFlowViewDefinition<TContext, TData>,
  surface: CmdFlowSurface,
): Frame<TContext, TData> {
  const values = Object.fromEntries(
    (definition.fields ?? []).map((field) => [field.id, initialFieldValue(field)]),
  );
  const form = immutable({ values, errors: {}, dirty: false, submitting: false });
  const snapshot: CmdFlowFrameSnapshot<TData> = immutable({
    id: frameId,
    surface,
    view: createViewSnapshot(definition),
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
    snapshot,
    candidates: new Map(),
    staticItems: new Map(),
    navigationRevision: 0,
    formVersion: 0,
    queryKeyGeneration: 0,
    rankExplanations: [],
  };
}
