import type { CmdFlow, CmdFlowOptions } from "./contracts/flow.js";
import { createCmdFlowRuntime } from "./runtime/create-runtime.js";

/**
 * Creates an isolated CmdFlow state machine.
 *
 * Construction is render- and SSR-safe: external subscriptions are activated only when the
 * returned instance is subscribed to or explicitly opened.
 */
export function createCmdFlow<TContext = Record<string, never>, TData = unknown>(
  options: CmdFlowOptions<TContext, TData> = {},
): CmdFlow<TContext, TData> {
  return createCmdFlowRuntime(options);
}
