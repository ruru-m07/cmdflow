import type {
  RankExplanation,
  RankingQueryPolicy,
  RankingResetSelector,
  RankingScope,
  RankingStore,
} from "./ranking-types.js";

declare const candidateIdBrand: unique symbol;
export type CandidateId = string & { readonly [candidateIdBrand]: true };
export type Surface = "main" | "actions";
export interface SurfaceAddress {
  readonly surface: Surface;
  readonly frameId: string;
}
export interface Clock {
  now(): number;
}
export interface ContextStore<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}
export interface MutableContextStore<T> extends ContextStore<T> {
  set(value: T): void;
}
export type Availability = boolean | { readonly reason: string };
export interface Keybinding {
  readonly key: string;
  readonly mod?: boolean;
  readonly ctrl?: boolean;
  readonly meta?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
}
export interface ActionEvaluation<T> {
  readonly appContext: T;
  readonly frame: FrameSnapshot;
  readonly item: ResolvedItem | null;
  readonly selection: readonly CandidateId[];
  readonly surface: Surface;
}
export interface ActionRunInput<T> extends ActionEvaluation<T> {
  readonly signal: AbortSignal;
  readonly executionId: string;
  readonly values: Readonly<Record<string, FieldValue>>;
}
export type ActionOutcome<T = unknown> =
  | { readonly type: "stay" }
  | { readonly type: "close"; readonly target?: "shell" | "actions" }
  | { readonly type: "pop-view"; readonly target?: Surface | "origin" }
  | {
      readonly type: "push-view" | "replace-view";
      readonly target?: Surface | "origin";
      readonly view: ViewDefinition<T>;
    };
export interface ActionDefinition<T = unknown> {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly keywords?: readonly string[];
  readonly shortcut?: Keybinding;
  readonly section?: string;
  readonly destructive?: boolean;
  readonly priority?: "primary" | "secondary" | "auxiliary";
  readonly lifecycle?: "origin-bound" | "detached";
  readonly learn?: boolean;
  readonly visible?: (input: ActionEvaluation<T>) => boolean;
  readonly enabled?: (input: ActionEvaluation<T>) => Availability;
  readonly run?: (
    input: ActionRunInput<T>,
    // biome-ignore lint/suspicious/noConfusingVoidType: Synchronous and async handlers may intentionally return nothing.
  ) => void | ActionOutcome<T> | Promise<void | ActionOutcome<T>>;
  readonly children?: readonly ActionDefinition<T>[];
  readonly view?: ViewDefinition<T>;
}
export interface CommandDefinition<T = unknown> extends ActionDefinition<T> {
  readonly aliases?: readonly string[];
  readonly data?: unknown;
  readonly providerRank?: number;
  readonly favorite?: number;
  readonly contextTier?: number;
  readonly allowFallback?: boolean;
  readonly personalize?: boolean;
  readonly disabled?: Availability;
  readonly actions?: readonly ActionDefinition<T>[];
}
export type FieldValue = string | number | boolean | readonly string[];
export interface FormField<T = unknown> {
  readonly id: string;
  readonly label: string;
  readonly type?: "text" | "password" | "email" | "number" | "textarea" | "checkbox" | "select";
  readonly defaultValue?: FieldValue;
  readonly required?: boolean;
  readonly sensitive?: boolean;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  readonly validate?: (
    value: FieldValue,
    input: ActionRunInput<T>,
  ) => string | undefined | Promise<string | undefined>;
}
export interface ViewDefinition<T = unknown> {
  readonly id: string;
  readonly type: "list" | "detail" | "form" | "custom";
  readonly title?: string;
  readonly description?: string;
  readonly items?: readonly CommandDefinition<T>[];
  readonly sourceIds?: readonly string[];
  readonly actions?: readonly ActionDefinition<T>[];
  readonly fields?: readonly FormField<T>[];
  readonly submit?: ActionDefinition<T>;
  readonly rendererKey?: string;
  readonly payloadKey?: string;
  readonly selectionMode?: "none" | "single" | "multiple";
  readonly learnableQuery?: boolean;
  readonly rankingContextKey?: string;
}
export interface ViewSnapshot {
  readonly id: string;
  readonly type: ViewDefinition["type"];
  readonly title: string;
  readonly description?: string;
  readonly rendererKey?: string;
  readonly payloadKey?: string;
  readonly selectionMode: "none" | "single" | "multiple";
  readonly fields: readonly Omit<FormField, "validate">[];
}
export interface ActionSnapshot {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly shortcut?: Keybinding;
  readonly section?: string;
  readonly destructive: boolean;
  readonly disabled: boolean;
  readonly disabledReason?: string;
  readonly priority: "primary" | "secondary" | "auxiliary";
  readonly hasChildren: boolean;
}
export interface ResolvedItem {
  readonly candidateId: CandidateId;
  readonly id: string;
  readonly sourceId: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly keywords?: readonly string[];
  readonly aliases?: readonly string[];
  readonly section?: string;
  readonly data?: unknown;
  readonly providerRank?: number;
  readonly favorite?: number;
  readonly contextTier?: number;
  readonly allowFallback?: boolean;
  readonly personalize?: boolean;
  readonly sourcePriority: number;
  readonly disabled: boolean;
  readonly disabledReason?: string;
  readonly actions: readonly ActionSnapshot[];
}
export interface SourceSnapshot {
  readonly id: string;
  readonly status: "idle" | "loading" | "success" | "error";
  readonly error?: string;
  readonly nextCursor?: string;
  readonly searchEpoch: number;
}
export interface FormSnapshot {
  readonly values: Readonly<Record<string, FieldValue>>;
  readonly errors: Readonly<Record<string, string>>;
  readonly dirty: boolean;
  readonly submitting: boolean;
}
export interface FrameSnapshot {
  readonly id: string;
  readonly surface: Surface;
  readonly view: ViewSnapshot;
  readonly query: string;
  readonly composing: boolean;
  readonly activeId: CandidateId | null;
  readonly selectedIds: readonly CandidateId[];
  readonly items: readonly ResolvedItem[];
  readonly sources: readonly SourceSnapshot[];
  readonly actions: readonly ActionSnapshot[];
  readonly scrollAnchor: { readonly candidateId: CandidateId; readonly offset: number } | null;
  readonly form: FormSnapshot;
}
export interface ExecutionSnapshot {
  readonly id: string;
  readonly actionId: string;
  readonly frameId: string | null;
  readonly status: "pending" | "success" | "error" | "aborted";
  readonly error?: string;
}
export interface ConfirmationSnapshot {
  readonly id: string;
  readonly title: string;
  readonly kind: "destructive" | "discard";
}
export interface CmdFlowSnapshot {
  readonly revision: number;
  readonly open: boolean;
  readonly sessionId: number;
  readonly main: readonly FrameSnapshot[];
  readonly actions: readonly FrameSnapshot[];
  readonly current: FrameSnapshot;
  readonly actionFrame: FrameSnapshot | null;
  readonly executions: readonly ExecutionSnapshot[];
  readonly confirmation: ConfirmationSnapshot | null;
  readonly rankingReady: boolean;
  readonly destroyed: boolean;
}
export interface SearchRequest<T> {
  readonly rawQuery: string;
  readonly normalizedQuery: string;
  readonly normalizationVersion: string;
  readonly context: T;
  readonly scope: RankingScope;
  readonly cursor?: string;
  readonly signal: AbortSignal;
}
export type BatchMutation<T> =
  | { readonly operation: "replace"; readonly items: readonly CommandDefinition<T>[] }
  | {
      readonly operation: "patch";
      readonly items: readonly CommandDefinition<T>[];
      readonly remove?: readonly string[];
    };
export type FinalResultBatch<T> = BatchMutation<T> & {
  readonly done: true;
  readonly nextCursor?: string;
};
export type ResultBatch<T> =
  | FinalResultBatch<T>
  | (BatchMutation<T> & { readonly done: false; readonly nextCursor?: never });
export interface ResultSource<T = unknown> {
  readonly id: string;
  readonly sourcePriority?: number;
  readonly debounceMs?: number;
  readonly minQueryLength?: number;
  readonly limit?: number;
  readonly remoteQuery?: "raw" | "normalized" | "none";
  readonly search: (
    request: SearchRequest<T>,
  ) => FinalResultBatch<T> | Promise<FinalResultBatch<T>> | AsyncIterable<ResultBatch<T>>;
}
export interface ExtensionDefinition<T = unknown> {
  readonly id: string;
  readonly commands?: readonly CommandDefinition<T>[];
  readonly sources?: readonly ResultSource<T>[];
}
export interface DomEffect {
  readonly id: number;
  readonly revision: number;
  readonly type: "focus" | "scroll" | "announce" | "restore";
  readonly frameId?: string;
  readonly target?: "input" | "form" | "confirmation";
  readonly fieldId?: string;
  readonly message?: string;
}
export interface DiagnosticEvent {
  readonly type: string;
  readonly id?: string;
  readonly message?: string;
  readonly time: number;
}
export interface InvokeOptions {
  /** Required for UI navigation outcomes. Omission invokes application work only. */
  readonly address?: SurfaceAddress;
  readonly candidateId?: CandidateId;
  readonly actionId?: string;
  readonly confirmed?: boolean;
}
export interface ExecutionResult {
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
      readonly address?: SurfaceAddress;
    }
  | {
      readonly type: "MOVE_ACTIVE";
      readonly direction: "next" | "previous" | "first" | "last";
      readonly address?: SurfaceAddress;
    }
  | {
      readonly type: "SET_ACTIVE";
      readonly candidateId: CandidateId;
      readonly address?: SurfaceAddress;
    }
  | {
      readonly type: "OPEN_ACTIONS";
      readonly candidateId?: CandidateId;
      readonly address?: SurfaceAddress;
    }
  | { readonly type: "CLOSE_ACTIONS" }
  | { readonly type: "POP_VIEW"; readonly surface?: Surface }
  | { readonly type: "INVOKE"; readonly options?: InvokeOptions };
export interface CmdFlowOptions<T> {
  readonly id?: string;
  readonly context?: T | ContextStore<T>;
  readonly root?: ViewDefinition<T>;
  readonly commands?: readonly CommandDefinition<T>[];
  readonly sources?: readonly ResultSource<T>[];
  readonly clock?: Clock;
  readonly ranking?: {
    readonly store?: RankingStore;
    readonly scope: RankingScope;
    readonly queryPolicy?:
      | RankingQueryPolicy
      | ((scope: RankingScope) => Promise<RankingQueryPolicy>);
  };
  readonly onDiagnostic?: (event: DiagnosticEvent) => void;
  readonly onOpenChange?: (open: boolean) => void;
  readonly controlledOpen?: boolean;
  readonly onQueryChange?: (query: string, address: SurfaceAddress) => void;
  readonly controlledQuery?: boolean;
}
export interface CmdFlow<T = unknown> {
  readonly id: string;
  getSnapshot(): CmdFlowSnapshot;
  getServerSnapshot(): CmdFlowSnapshot;
  subscribe(listener: () => void): () => void;
  onEvent(listener: (event: DiagnosticEvent) => void): () => void;
  getContext(): T;
  setContext(context: T): void;
  registerExtension(extension: ExtensionDefinition<T>): () => void;
  registerCommand(command: CommandDefinition<T>): () => void;
  registerSource(source: ResultSource<T>): () => void;
  open(): void;
  close(): void;
  setOpen(open: boolean): void;
  setQuery(query: string, address?: SurfaceAddress, composing?: boolean): void;
  syncQuery(query: string, address?: SurfaceAddress): void;
  moveActive(direction: "next" | "previous" | "first" | "last", address?: SurfaceAddress): void;
  setActive(id: CandidateId, address?: SurfaceAddress): void;
  toggleSelected(id: CandidateId, address?: SurfaceAddress): void;
  openActions(id?: CandidateId, address?: SurfaceAddress): void;
  closeActions(): void;
  push(view: ViewDefinition<T>, surface?: Surface): void;
  replace(view: ViewDefinition<T>, surface?: Surface): void;
  pop(surface?: Surface): void;
  resetToRoot(): void;
  escape(): void;
  invoke(options?: InvokeOptions): Promise<ExecutionResult>;
  confirm(): Promise<void>;
  cancelConfirmation(): void;
  loadMore(sourceId: string, address?: SurfaceAddress): Promise<void>;
  refresh(address?: SurfaceAddress): void;
  setScrollAnchor(anchor: FrameSnapshot["scrollAnchor"], address?: SurfaceAddress): void;
  setField(fieldId: string, value: FieldValue, address?: SurfaceAddress): void;
  submitForm(address?: SurfaceAddress): Promise<ExecutionResult>;
  getSafeDraft(address?: SurfaceAddress): Readonly<Record<string, FieldValue>>;
  restoreDraft(values: Readonly<Record<string, FieldValue>>, address?: SurfaceAddress): void;
  explainRanking(address?: SurfaceAddress): readonly RankExplanation[];
  resetRanking(selector?: RankingResetSelector): Promise<void>;
  getDomEffects(): readonly DomEffect[];
  acknowledgeDomEffects(ids: readonly number[]): void;
  send(event: CmdFlowEvent): void;
  destroy(): void;
}
