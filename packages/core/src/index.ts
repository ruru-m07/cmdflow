export {
  createCandidateId,
  createContextStore,
  createRankingSurfaceId,
  parseCandidateId,
} from "./identity.js";
export * from "./ranking.js";
export * from "./ranking-types.js";
export { createCmdFlow } from "./store.js";
export * from "./types.js";

import type {
  ActionDefinition,
  CommandDefinition,
  ExtensionDefinition,
  ViewDefinition,
} from "./types.js";

export const defineCommand = <T>(command: CommandDefinition<T>): CommandDefinition<T> => command;
export const defineAction = <T>(action: ActionDefinition<T>): ActionDefinition<T> => action;
export const defineExtension = <T>(extension: ExtensionDefinition<T>): ExtensionDefinition<T> =>
  extension;
export const defineView = <T>(view: ViewDefinition<T>): ViewDefinition<T> => view;
