import type {
  CmdFlowActionDefinition,
  CmdFlowActionEvaluation,
  CmdFlowActionOutcome,
  CmdFlowCommandDefinition,
  CmdFlowResultSource,
} from "../contracts/definitions.js";
import type { CmdFlowDomEffect, CmdFlowExecutionResult } from "../contracts/flow.js";
import type { CandidateId } from "../contracts/primitives.js";
import type {
  CmdFlowActionSnapshot,
  CmdFlowConfirmationSnapshot,
  CmdFlowExecutionSnapshot,
} from "../contracts/snapshots.js";
import { immutable } from "../identity.js";
import type { RankingQueryKey } from "../ranking-types.js";
import { commandFromAction } from "./definitions.js";
import type { Frame, RunningExecution } from "./state.js";
import { abortable, errorMessage, evaluateAvailability, terminalResult } from "./utils.js";

export interface ExecutionFeedback<TContext, TData> {
  readonly executionId: string;
  readonly candidateId: CandidateId;
  readonly action: CmdFlowActionDefinition<TContext, TData>;
  readonly command: CmdFlowCommandDefinition<TContext, TData>;
  readonly frame: Frame<TContext, TData>;
  readonly query: string;
  readonly queryKey?: RankingQueryKey;
}

export interface ExecuteOptions {
  readonly confirmed?: boolean;
  readonly submittedVersion?: number;
  readonly allowUi?: boolean;
  readonly executionId?: string;
}

export interface ExecutionRuntimeDependencies<TContext, TData> {
  readonly createExecutionId: () => string;
  readonly createConfirmationId: () => string;
  readonly getSession: () => number;
  readonly isDestroyed: () => boolean;
  readonly isFrameAlive: (frame: Frame<TContext, TData>) => boolean;
  readonly getMainFrames: () => readonly Frame<TContext, TData>[];
  readonly getActionFrames: () => readonly Frame<TContext, TData>[];
  readonly evaluate: (
    frame: Frame<TContext, TData>,
    candidateId?: CandidateId,
  ) => CmdFlowActionEvaluation<TContext, TData>;
  readonly snapshotAction: (
    action: CmdFlowActionDefinition<TContext, TData>,
    input: CmdFlowActionEvaluation<TContext, TData>,
  ) => CmdFlowActionSnapshot | null;
  readonly applyOutcome: (
    // biome-ignore lint/suspicious/noConfusingVoidType: Action handlers intentionally return void when no outcome is requested.
    outcome: CmdFlowActionOutcome<TContext, TData> | void,
    task: RunningExecution<TContext, TData>,
  ) => void;
  readonly publish: () => void;
  readonly diagnostic: (type: string, id?: string, detail?: string) => void;
  readonly effect: (
    type: CmdFlowDomEffect["type"],
    extras?: Omit<CmdFlowDomEffect, "id" | "revision" | "type">,
  ) => void;
  readonly onExecutionStart: () => void;
  readonly recordSuccessfulUse: (feedback: ExecutionFeedback<TContext, TData>) => void;
}

export interface ExecutionRuntime<TContext, TData> {
  execute(
    frame: Frame<TContext, TData>,
    candidateId: CandidateId | undefined,
    action: CmdFlowActionDefinition<TContext, TData>,
    options?: ExecuteOptions,
  ): Promise<CmdFlowExecutionResult>;
  requestDiscard(work: () => void): void;
  confirm(): Promise<CmdFlowExecutionResult | undefined>;
  cancelConfirmation(): void;
  clearConfirmation(): void;
  getConfirmation(): CmdFlowConfirmationSnapshot | null;
  getExecutions(): ReadonlyMap<string, CmdFlowExecutionSnapshot>;
  abortFrame(frame: Frame<TContext, TData>): void;
  abortOriginBound(): void;
  abortOwned(
    commands: readonly CmdFlowCommandDefinition<TContext, TData>[],
    sources: readonly CmdFlowResultSource<TContext, TData>[],
  ): void;
  abortAll(): void;
}

export function createExecutionRuntime<TContext, TData>(
  dependencies: ExecutionRuntimeDependencies<TContext, TData>,
): ExecutionRuntime<TContext, TData> {
  const running = new Map<string, RunningExecution<TContext, TData>>();
  const executions = new Map<string, CmdFlowExecutionSnapshot>();
  let confirmation: CmdFlowConfirmationSnapshot | null = null;
  let confirmationWork: (() => Promise<CmdFlowExecutionResult>) | null = null;

  function setConfirmation(
    next: CmdFlowConfirmationSnapshot,
    work: () => Promise<CmdFlowExecutionResult>,
  ): void {
    confirmation = Object.freeze(next);
    confirmationWork = work;
    dependencies.effect("focus", { target: "confirmation" });
    dependencies.publish();
  }

  function clearConfirmation(): void {
    confirmation = null;
    confirmationWork = null;
  }

  function requestDiscard(work: () => void): void {
    const confirmationId = dependencies.createConfirmationId();
    setConfirmation(
      {
        id: confirmationId,
        kind: "discard",
        title: "Discard unsaved changes?",
      },
      async () => {
        work();
        return terminalResult(confirmationId, "success");
      },
    );
  }

  async function confirm(): Promise<CmdFlowExecutionResult | undefined> {
    const work = confirmationWork;
    if (!work) return undefined;
    clearConfirmation();
    dependencies.publish();
    return work();
  }

  function cancelConfirmation(): void {
    clearConfirmation();
    dependencies.effect("restore");
    dependencies.publish();
  }

  function abortFrame(frame: Frame<TContext, TData>): void {
    for (const task of running.values()) {
      if (task.frame === frame && task.action.lifecycle !== "detached") task.controller.abort();
    }
  }

  function abortOriginBound(): void {
    for (const task of running.values()) {
      if (task.action.lifecycle !== "detached") task.controller.abort();
    }
  }

  function abortOwned(
    commands: readonly CmdFlowCommandDefinition<TContext, TData>[],
    sources: readonly CmdFlowResultSource<TContext, TData>[],
  ): void {
    for (const task of running.values()) {
      if (
        commands.some((command) => command === task.owner?.command) ||
        sources.some((source) => source === task.owner?.source)
      ) {
        task.controller.abort();
      }
    }
  }

  function abortAll(): void {
    for (const task of running.values()) task.controller.abort();
  }

  async function execute(
    frame: Frame<TContext, TData>,
    candidateId: CandidateId | undefined,
    action: CmdFlowActionDefinition<TContext, TData>,
    options: ExecuteOptions = {},
  ): Promise<CmdFlowExecutionResult> {
    const executionId = options.executionId ?? dependencies.createExecutionId();
    if (!dependencies.isFrameAlive(frame)) return terminalResult(executionId, "aborted");
    if (candidateId && !frame.candidates.has(candidateId)) {
      return terminalResult(executionId, "disabled");
    }
    const input = dependencies.evaluate(frame, candidateId);
    const actionState = dependencies.snapshotAction(action, input);
    const item = candidateId
      ? frame.snapshot.items.find((entry) => entry.candidateId === candidateId)
      : undefined;
    if (!actionState || actionState.disabled || item?.disabled) {
      return terminalResult(executionId, "disabled");
    }
    if (action.destructive && !options.confirmed) {
      const confirmationSession = dependencies.getSession();
      const confirmedCommand = candidateId ? frame.candidates.get(candidateId) : undefined;
      setConfirmation(
        {
          id: executionId,
          kind: "destructive",
          title: `${action.title}?`,
        },
        async () => {
          if (
            dependencies.isFrameAlive(frame) &&
            confirmationSession === dependencies.getSession() &&
            (!candidateId || frame.candidates.get(candidateId) === confirmedCommand)
          ) {
            return execute(frame, candidateId, action, {
              ...options,
              confirmed: true,
              executionId,
            });
          }
          return terminalResult(executionId, "aborted");
        },
      );
      return terminalResult(executionId, "confirmation");
    }

    const controller = new AbortController();
    const originFrame = frame.actionOrigin
      ? (dependencies.getMainFrames().find((entry) => entry.id === frame.actionOrigin?.frameId) ??
        frame)
      : frame;
    const originCandidateId = frame.actionOrigin?.candidateId ?? candidateId;
    const originItem = originFrame.snapshot.items.find(
      (entry) => entry.candidateId === originCandidateId,
    );
    const originCommand = originCandidateId
      ? originFrame.candidates.get(originCandidateId)
      : undefined;
    try {
      const originInput = dependencies.evaluate(originFrame, originCandidateId);
      if (
        originCommand &&
        (originCommand.visible?.(originInput) === false ||
          evaluateAvailability(originCommand.enabled?.(originInput)).disabled ||
          originCommand.disabled === true ||
          typeof originCommand.disabled === "object")
      ) {
        return terminalResult(executionId, "disabled");
      }
    } catch (error) {
      dependencies.diagnostic("predicate-error", action.id, errorMessage(error));
      return terminalResult(executionId, "disabled");
    }

    const actionFrames = dependencies.getActionFrames();
    const task: RunningExecution<TContext, TData> = {
      controller,
      frame,
      session: dependencies.getSession(),
      action,
      candidateId,
      mainId: dependencies.getMainFrames().at(-1)?.id ?? "",
      actionsId: actionFrames.at(-1)?.id,
      allowUi: options.allowUi ?? true,
      owner: {
        command: originCommand,
        source: originItem ? originFrame.sources.get(originItem.sourceId)?.definition : undefined,
      },
    };
    const shouldLearn =
      originCandidateId &&
      action.learn !== false &&
      (action.type !== "submenu" || action.learn === true) &&
      originCommand?.personalize !== false &&
      originFrame.definition.learnableQuery !== false &&
      originFrame.definition.type === "list";
    const feedbackQuery = originFrame.query;
    const feedbackKey = originFrame.queryKey;

    dependencies.onExecutionStart();
    running.set(executionId, task);
    executions.set(
      executionId,
      Object.freeze({ id: executionId, actionId: action.id, frameId: frame.id, status: "pending" }),
    );
    while (executions.size > 50) {
      const first = [...executions].find(([key]) => !running.has(key));
      if (!first) break;
      executions.delete(first[0]);
    }
    dependencies.publish();
    dependencies.diagnostic("execution-start", action.id);

    try {
      if (controller.signal.aborted || !dependencies.isFrameAlive(frame)) {
        throw new Error("Operation aborted");
      }
      const runInput = {
        ...input,
        signal: controller.signal,
        executionId,
        values: frame.form.values,
      };
      // biome-ignore lint/suspicious/noConfusingVoidType: Awaited action handlers may intentionally produce void.
      const outcome: CmdFlowActionOutcome<TContext, TData> | void =
        action.type === "submenu"
          ? {
              type: "push-view",
              target: "actions",
              view: {
                id: action.id,
                type: "list",
                title: action.title,
                items: action.actions.map(commandFromAction),
                learnableQuery: false,
              },
            }
          : action.type === "view"
            ? {
                type: "push-view",
                target: action.target ?? "main",
                view: action.view,
              }
            : await abortable(action.run(runInput), controller.signal);
      if (controller.signal.aborted || dependencies.isDestroyed()) {
        executions.set(
          executionId,
          Object.freeze({
            id: executionId,
            actionId: action.id,
            frameId: frame.id,
            status: "aborted",
          }),
        );
        dependencies.publish();
        return terminalResult(executionId, "aborted");
      }
      executions.set(
        executionId,
        Object.freeze({
          id: executionId,
          actionId: action.id,
          frameId: frame.id,
          status: "success",
        }),
      );
      if (
        options.submittedVersion !== undefined &&
        frame.formVersion === options.submittedVersion
      ) {
        frame.form = immutable({ ...frame.form, dirty: false });
      }
      dependencies.applyOutcome(outcome, task);
      dependencies.effect("announce", { message: `${action.title} completed` });
      dependencies.publish();
      dependencies.diagnostic("execution-success", action.id);
      if (shouldLearn && originCandidateId && originCommand) {
        dependencies.recordSuccessfulUse({
          executionId,
          candidateId: originCandidateId,
          action,
          command: originCommand,
          frame: originFrame,
          query: feedbackQuery,
          queryKey: feedbackKey,
        });
      }
      return terminalResult(executionId, "success");
    } catch (error) {
      const status = controller.signal.aborted ? "aborted" : "error";
      executions.set(
        executionId,
        Object.freeze({
          id: executionId,
          actionId: action.id,
          frameId: frame.id,
          status,
          ...(status === "error" ? { error: errorMessage(error) } : {}),
        }),
      );
      if (status === "error") {
        dependencies.effect("announce", { message: `${action.title} failed` });
      }
      dependencies.publish();
      dependencies.diagnostic(
        `execution-${status}`,
        action.id,
        status === "error" ? errorMessage(error) : undefined,
      );
      return terminalResult(
        executionId,
        status,
        status === "error" ? errorMessage(error) : undefined,
      );
    } finally {
      running.delete(executionId);
    }
  }

  return {
    execute,
    requestDiscard,
    confirm,
    cancelConfirmation,
    clearConfirmation,
    getConfirmation: () => confirmation,
    getExecutions: () => executions,
    abortFrame,
    abortOriginBound,
    abortOwned,
    abortAll,
  };
}
