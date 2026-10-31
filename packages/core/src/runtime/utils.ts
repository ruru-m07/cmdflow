import type { CmdFlowExecutionResult as ExecutionResult } from "../contracts/flow.js";
import type {
  CmdFlowAvailability as Availability,
  CmdFlowContextStore as ContextStore,
} from "../contracts/primitives.js";

export function isContextStore<TContext>(value: unknown): value is ContextStore<TContext> {
  return (
    !!value &&
    typeof value === "object" &&
    "getSnapshot" in value &&
    typeof value.getSnapshot === "function" &&
    "subscribe" in value &&
    typeof value.subscribe === "function"
  );
}

export function evaluateAvailability(value: Availability | undefined): {
  disabled: boolean;
  disabledReason?: string;
} {
  if (value === false) return { disabled: true };
  if (typeof value === "object") return { disabled: true, disabledReason: value.reason };
  return { disabled: false };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function abortable<T>(value: T | PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Operation aborted"));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(value)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export function terminalResult(
  id: string,
  status: ExecutionResult["status"],
  error?: string,
): ExecutionResult {
  return Object.freeze({ id, status, ...(error ? { error } : {}) });
}
