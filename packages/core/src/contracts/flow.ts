import type {
  RankExplanation,
  RankingQueryPolicy,
  RankingResetSelector,
  RankingScope,
  RankingStore,
} from "../ranking-types.js";
import type {
  CmdFlowCommandDefinition,
  CmdFlowExtensionDefinition,
  CmdFlowFieldValue,
  CmdFlowResultSource,
  CmdFlowViewDefinition,
} from "./definitions.js";
import type {
  CandidateId,
  CmdFlowClock,
  CmdFlowContextStore,
  CmdFlowSurface,
  CmdFlowSurfaceAddress,
} from "./primitives.js";
import type { CmdFlowFrameSnapshot, CmdFlowSnapshot } from "./snapshots.js";

export interface CmdFlowDomEffect {
  readonly id: number;
  readonly revision: number;
  readonly type: "focus" | "scroll" | "announce" | "restore";
  readonly frameId?: string;
  readonly target?: "input" | "form" | "confirmation";
  readonly fieldId?: string;
  readonly message?: string;
}

export interface CmdFlowDiagnosticEvent {
  readonly type: string;
  readonly id?: string;
  readonly message?: string;
  readonly time: number;
}

export interface CmdFlowInvokeOptions {
  /** Required for UI navigation outcomes. Omission invokes application work only. */
  readonly address?: CmdFlowSurfaceAddress;
  readonly candidateId?: CandidateId;
  readonly actionId?: string;
}

export interface CmdFlowExecutionResult {
  readonly id: string;
  readonly status: "success" | "error" | "aborted" | "disabled" | "confirmation";
  readonly error?: string;
}

export type CmdFlowEvent =
  | { readonly type: "OPEN" }
  | { readonly type: "CLOSE" }
  | {
      readonly type: "INPUT_CHANGED";
      readonly value: string;
      readonly phase?: "composing" | "committed";
      readonly address?: CmdFlowSurfaceAddress;
    }
  | {
      readonly type: "MOVE_ACTIVE";
      readonly direction: "next" | "previous" | "first" | "last";
      readonly address?: CmdFlowSurfaceAddress;
    }
  | {
      readonly type: "SET_ACTIVE";
      readonly candidateId: CandidateId;
      readonly address?: CmdFlowSurfaceAddress;
    }
  | {
      readonly type: "OPEN_ACTIONS";
      readonly candidateId?: CandidateId;
      readonly address?: CmdFlowSurfaceAddress;
    }
  | { readonly type: "CLOSE_ACTIONS" }
  | { readonly type: "POP_VIEW"; readonly surface?: CmdFlowSurface }
  | { readonly type: "INVOKE"; readonly options?: CmdFlowInvokeOptions };

export interface CmdFlowOptions<TContext = Record<string, never>, TData = unknown> {
  readonly id?: string;
  readonly context?: TContext | CmdFlowContextStore<TContext>;
  /** Initial state used during construction without firing change callbacks. */
  readonly initialOpen?: boolean;
  /** Initial query for the root frame, including the server snapshot. */
  readonly initialQuery?: string;
  readonly root?: CmdFlowViewDefinition<TContext, TData>;
  readonly commands?: readonly CmdFlowCommandDefinition<TContext, TData>[];
  readonly sources?: readonly CmdFlowResultSource<TContext, TData>[];
  readonly clock?: CmdFlowClock;
  readonly ranking?: {
    readonly store?: RankingStore;
    readonly scope: RankingScope;
    readonly queryPolicy?:
      | RankingQueryPolicy
      | ((scope: RankingScope) => Promise<RankingQueryPolicy>);
  };
  readonly onDiagnostic?: (event: CmdFlowDiagnosticEvent) => void;
  readonly onOpenChange?: (open: boolean) => void;
  readonly controlledOpen?: boolean;
  readonly onQueryChange?: (query: string, address: CmdFlowSurfaceAddress) => void;
  readonly controlledQuery?: boolean;
}

export interface CmdFlow<TContext = unknown, TData = unknown> {
  readonly id: string;
  getSnapshot(): CmdFlowSnapshot<TData>;
  getServerSnapshot(): CmdFlowSnapshot<TData>;
  subscribe(listener: () => void): () => void;
  onEvent(listener: (event: CmdFlowDiagnosticEvent) => void): () => void;
  getContext(): TContext;
  setContext(context: TContext): void;
  registerExtension(extension: CmdFlowExtensionDefinition<TContext, TData>): () => void;
  registerCommand(command: CmdFlowCommandDefinition<TContext, TData>): () => void;
  registerSource(source: CmdFlowResultSource<TContext, TData>): () => void;
  open(): void;
  close(): void;
  setOpen(open: boolean): void;
  setQuery(query: string, address?: CmdFlowSurfaceAddress, composing?: boolean): void;
  syncQuery(query: string, address?: CmdFlowSurfaceAddress): void;
  moveActive(
    direction: "next" | "previous" | "first" | "last",
    address?: CmdFlowSurfaceAddress,
  ): void;
  setActive(id: CandidateId, address?: CmdFlowSurfaceAddress): void;
  toggleSelected(id: CandidateId, address?: CmdFlowSurfaceAddress): void;
  openActions(id?: CandidateId, address?: CmdFlowSurfaceAddress): void;
  closeActions(): void;
  push(view: CmdFlowViewDefinition<TContext, TData>, surface?: CmdFlowSurface): void;
  replace(view: CmdFlowViewDefinition<TContext, TData>, surface?: CmdFlowSurface): void;
  pop(surface?: CmdFlowSurface): void;
  resetToRoot(): void;
  escape(): void;
  invoke(options?: CmdFlowInvokeOptions): Promise<CmdFlowExecutionResult>;
  /** Resolves with the confirmed execution, or undefined when no confirmation is pending. */
  confirm(): Promise<CmdFlowExecutionResult | undefined>;
  cancelConfirmation(): void;
  loadMore(sourceId: string, address?: CmdFlowSurfaceAddress): Promise<void>;
  refresh(address?: CmdFlowSurfaceAddress): void;
  setScrollAnchor(
    anchor: CmdFlowFrameSnapshot<TData>["scrollAnchor"],
    address?: CmdFlowSurfaceAddress,
  ): void;
  setField(fieldId: string, value: CmdFlowFieldValue, address?: CmdFlowSurfaceAddress): void;
  submitForm(address?: CmdFlowSurfaceAddress): Promise<CmdFlowExecutionResult>;
  getSafeDraft(address?: CmdFlowSurfaceAddress): Readonly<Record<string, CmdFlowFieldValue>>;
  restoreDraft(
    values: Readonly<Record<string, CmdFlowFieldValue>>,
    address?: CmdFlowSurfaceAddress,
  ): void;
  explainRanking(address?: CmdFlowSurfaceAddress): readonly RankExplanation[];
  resetRanking(selector?: RankingResetSelector): Promise<void>;
  getDomEffects(): readonly CmdFlowDomEffect[];
  acknowledgeDomEffects(ids: readonly number[]): void;
  send(event: CmdFlowEvent): void;
  destroy(): void;
}

/** @deprecated Use {@link CmdFlowDomEffect}. */
export type DomEffect = CmdFlowDomEffect;
/** @deprecated Use {@link CmdFlowDiagnosticEvent}. */
export type DiagnosticEvent = CmdFlowDiagnosticEvent;
/** @deprecated Use {@link CmdFlowInvokeOptions}. */
export type InvokeOptions = CmdFlowInvokeOptions;
/** @deprecated Use {@link CmdFlowExecutionResult}. */
export type ExecutionResult = CmdFlowExecutionResult;
