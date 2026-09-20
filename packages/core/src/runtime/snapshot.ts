import type {
  CmdFlowSnapshot,
  CmdFlowConfirmationSnapshot as ConfirmationSnapshot,
  CmdFlowExecutionSnapshot as ExecutionSnapshot,
} from "../contracts/snapshots.js";
import type { Frame } from "./state.js";

export interface SnapshotInput<TContext, TData> {
  readonly revision: number;
  readonly open: boolean;
  readonly sessionId: number;
  readonly mainFrames: readonly Frame<TContext, TData>[];
  readonly actionFrames: readonly Frame<TContext, TData>[];
  readonly executions: ReadonlyMap<string, ExecutionSnapshot>;
  readonly confirmation: ConfirmationSnapshot | null;
  readonly rankingReady: boolean;
  readonly destroyed: boolean;
}

export function createRuntimeSnapshot<TContext, TData>(
  input: SnapshotInput<TContext, TData>,
): CmdFlowSnapshot<TData> {
  const mainFrame = input.mainFrames.at(-1)?.snapshot;
  if (!mainFrame) throw new Error("CmdFlow requires at least one main frame");
  const actionFrame = input.actionFrames.at(-1)?.snapshot ?? null;
  return Object.freeze({
    revision: input.revision,
    open: input.open,
    sessionId: input.sessionId,
    mainFrames: Object.freeze(input.mainFrames.map((frame) => frame.snapshot)),
    actionFrames: Object.freeze(input.actionFrames.map((frame) => frame.snapshot)),
    mainFrame,
    actionFrame,
    activeFrame: actionFrame ?? mainFrame,
    executions: Object.freeze([...input.executions.values()]),
    confirmation: input.confirmation,
    rankingReady: input.rankingReady,
    destroyed: input.destroyed,
  });
}
