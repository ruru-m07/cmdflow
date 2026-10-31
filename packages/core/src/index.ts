export * from "./contracts/definitions.js";
export * from "./contracts/flow.js";
export * from "./contracts/primitives.js";
export * from "./contracts/snapshots.js";
export { createCmdFlow } from "./create-flow.js";
export {
  createCandidateId,
  createContextStore,
  createRankingSurfaceId,
  parseCandidateId,
} from "./identity.js";
export * from "./ranking.js";
export * from "./ranking-types.js";

import type {
  CmdFlowActionDefinition,
  CmdFlowCommandDefinition,
  CmdFlowExtensionDefinition,
  CmdFlowViewDefinition,
} from "./contracts/definitions.js";

export function defineCommand<TContext = unknown, TData = unknown>(
  command: CmdFlowCommandDefinition<TContext, TData>,
): CmdFlowCommandDefinition<TContext, TData> {
  return command;
}

export function defineAction<TContext = unknown, TData = unknown>(
  action: CmdFlowActionDefinition<TContext, TData>,
): CmdFlowActionDefinition<TContext, TData> {
  return action;
}

export function defineExtension<TContext = unknown, TData = unknown>(
  extension: CmdFlowExtensionDefinition<TContext, TData>,
): CmdFlowExtensionDefinition<TContext, TData> {
  return extension;
}

export function defineView<TContext = unknown, TData = unknown>(
  view: CmdFlowViewDefinition<TContext, TData>,
): CmdFlowViewDefinition<TContext, TData> {
  return view;
}
