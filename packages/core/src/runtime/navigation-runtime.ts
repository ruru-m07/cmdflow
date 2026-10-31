import type { CmdFlowViewDefinition } from "../contracts/definitions.js";
import type { CmdFlowDomEffect } from "../contracts/flow.js";
import type { CmdFlowSurface } from "../contracts/primitives.js";
import { normalizeViewDefinition } from "./definitions.js";
import type { Frame } from "./state.js";

export interface NavigationRuntimeDependencies<TContext, TData> {
  readonly mainFrames: Frame<TContext, TData>[];
  readonly actionFrames: Frame<TContext, TData>[];
  readonly isDestroyed: () => boolean;
  readonly createFrame: (
    definition: CmdFlowViewDefinition<TContext, TData>,
    surface: CmdFlowSurface,
  ) => Frame<TContext, TData>;
  readonly disposeFrame: (frame: Frame<TContext, TData>) => void;
  readonly requestDiscard: (
    work: () => void,
    affected?: readonly Frame<TContext, TData>[],
  ) => boolean;
  readonly releaseRanking: () => void;
  readonly deriveQuery: (frame: Frame<TContext, TData>) => void;
  readonly hydrateRanking: () => void;
  readonly startSources: (frame: Frame<TContext, TData>, clear?: boolean) => void;
  readonly effect: (
    type: CmdFlowDomEffect["type"],
    extras?: Omit<CmdFlowDomEffect, "id" | "revision" | "type">,
  ) => void;
  readonly publish: () => void;
  readonly diagnostic: (type: string, id?: string, detail?: string) => void;
}

export interface NavigationRuntime<TContext, TData> {
  closeActionStack(): void;
  removeFrames(surface: CmdFlowSurface, from: number): void;
  push(
    definition: CmdFlowViewDefinition<TContext, TData>,
    surface: CmdFlowSurface,
    replace?: boolean,
  ): void;
  pop(surface: CmdFlowSurface): void;
}

export function createNavigationRuntime<TContext, TData>(
  dependencies: NavigationRuntimeDependencies<TContext, TData>,
): NavigationRuntime<TContext, TData> {
  function stackFor(surface: CmdFlowSurface): Frame<TContext, TData>[] {
    return surface === "main" ? dependencies.mainFrames : dependencies.actionFrames;
  }

  function closeActionStack(): void {
    for (const frame of dependencies.actionFrames.splice(0)) {
      dependencies.disposeFrame(frame);
    }
    dependencies.effect("restore");
  }

  function removeFrames(surface: CmdFlowSurface, from: number): void {
    for (const frame of stackFor(surface).splice(from)) dependencies.disposeFrame(frame);
  }

  function pushNormalized(
    definition: CmdFlowViewDefinition<TContext, TData>,
    surface: CmdFlowSurface,
    replace: boolean,
    discarded: boolean,
  ): void {
    if (dependencies.isDestroyed()) return;
    const stack = stackFor(surface);
    const replacing = replace ? stack.at(-1) : undefined;
    if (
      !discarded &&
      replacing &&
      dependencies.requestDiscard(
        () => pushNormalized(definition, surface, replace, true),
        [replacing],
      )
    ) {
      return;
    }
    const origin = dependencies.actionFrames.at(-1)?.actionOrigin;
    if (replace && stack.length) {
      dependencies.disposeFrame(stack.pop() as Frame<TContext, TData>);
    }
    if (surface === "main") closeActionStack();
    const frame = dependencies.createFrame(definition, surface);
    if (surface === "actions") frame.actionOrigin = origin;
    stack.push(frame);
    dependencies.releaseRanking();
    dependencies.deriveQuery(frame);
    dependencies.hydrateRanking();
    dependencies.startSources(frame);
    dependencies.effect("focus", {
      frameId: frame.id,
      target: definition.type === "form" ? "form" : "input",
    });
    dependencies.publish();
    dependencies.diagnostic(replace ? "view-replace" : "view-push", definition.id);
  }

  function push(
    definition: CmdFlowViewDefinition<TContext, TData>,
    surface: CmdFlowSurface,
    replace = false,
  ): void {
    pushNormalized(normalizeViewDefinition(definition), surface, replace, false);
  }

  function pop(surface: CmdFlowSurface): void {
    const stack = stackFor(surface);
    if (surface === "main" && stack.length <= 1) return;
    const frame = stack.at(-1);
    if (!frame) return;
    const performPop = () => {
      if (surface === "main") closeActionStack();
      dependencies.disposeFrame(stack.pop() as Frame<TContext, TData>);
      const next = stack.at(-1);
      if (next) {
        dependencies.effect("focus", {
          frameId: next.id,
          target: next.definition.type === "form" ? "form" : "input",
        });
        dependencies.effect("scroll", { frameId: next.id });
      } else {
        dependencies.effect("restore");
      }
      dependencies.publish();
      dependencies.diagnostic("view-pop", frame.definition.id);
    };
    if (
      dependencies.requestDiscard(
        performPop,
        surface === "main" ? [frame, ...dependencies.actionFrames] : [frame],
      )
    ) {
      return;
    }
    performPop();
  }

  return { closeActionStack, removeFrames, push, pop };
}
