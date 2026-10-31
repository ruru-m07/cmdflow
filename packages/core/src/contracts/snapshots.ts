import type {
  CmdFlowFieldValue,
  CmdFlowFormField,
  CmdFlowRendererDescriptor,
} from "./definitions.js";
import type { CandidateId, CmdFlowKeybinding, CmdFlowSurface } from "./primitives.js";

type WithoutValidator<TField> = TField extends unknown ? Omit<TField, "validate"> : never;

export type CmdFlowFormFieldSnapshot = WithoutValidator<CmdFlowFormField>;

export interface CmdFlowViewSnapshot {
  readonly id: string;
  readonly type: "list" | "detail" | "form" | "custom";
  readonly title: string;
  readonly description?: string;
  readonly renderer?: CmdFlowRendererDescriptor;
  readonly selectionMode: "none" | "single" | "multiple";
  readonly fields: readonly CmdFlowFormFieldSnapshot[];
}

export interface CmdFlowActionSnapshot {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly shortcut?: CmdFlowKeybinding;
  readonly section?: string;
  readonly destructive: boolean;
  readonly disabled: boolean;
  readonly disabledReason?: string;
  readonly priority: "primary" | "secondary" | "auxiliary";
  readonly hasChildren: boolean;
}

export interface CmdFlowResolvedItem<TData = unknown> {
  readonly candidateId: CandidateId;
  readonly id: string;
  readonly sourceId: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly keywords?: readonly string[];
  readonly aliases?: readonly string[];
  readonly section?: string;
  readonly data?: TData;
  readonly providerRank?: number;
  readonly favorite?: number;
  readonly contextTier?: number;
  readonly allowFallback?: boolean;
  readonly personalize?: boolean;
  readonly sourcePriority: number;
  readonly disabled: boolean;
  readonly disabledReason?: string;
  readonly actions: readonly CmdFlowActionSnapshot[];
}

export interface CmdFlowSourceSnapshot {
  readonly id: string;
  readonly status: "idle" | "loading" | "success" | "error";
  readonly error?: string;
  readonly nextCursor?: string;
  readonly searchEpoch: number;
}

export interface CmdFlowFormSnapshot {
  readonly values: Readonly<Record<string, CmdFlowFieldValue>>;
  readonly errors: Readonly<Record<string, string>>;
  readonly dirty: boolean;
  readonly submitting: boolean;
}

export interface CmdFlowFrameSnapshot<TData = unknown> {
  readonly id: string;
  readonly surface: CmdFlowSurface;
  readonly view: CmdFlowViewSnapshot;
  readonly query: string;
  readonly composing: boolean;
  readonly activeId: CandidateId | null;
  readonly selectedIds: readonly CandidateId[];
  readonly items: readonly CmdFlowResolvedItem<TData>[];
  readonly sources: readonly CmdFlowSourceSnapshot[];
  readonly actions: readonly CmdFlowActionSnapshot[];
  readonly scrollAnchor: {
    readonly candidateId: CandidateId;
    readonly offset: number;
  } | null;
  readonly form: CmdFlowFormSnapshot;
}

export interface CmdFlowExecutionSnapshot {
  readonly id: string;
  readonly actionId: string;
  readonly frameId: string | null;
  readonly status: "pending" | "success" | "error" | "aborted";
  readonly error?: string;
}

export interface CmdFlowConfirmationSnapshot {
  readonly id: string;
  readonly title: string;
  readonly kind: "destructive" | "discard";
}

export interface CmdFlowSnapshot<TData = unknown> {
  readonly revision: number;
  readonly open: boolean;
  readonly sessionId: number;
  readonly mainFrames: readonly CmdFlowFrameSnapshot<TData>[];
  readonly actionFrames: readonly CmdFlowFrameSnapshot<TData>[];
  readonly mainFrame: CmdFlowFrameSnapshot<TData>;
  readonly actionFrame: CmdFlowFrameSnapshot<TData> | null;
  readonly activeFrame: CmdFlowFrameSnapshot<TData>;
  readonly executions: readonly CmdFlowExecutionSnapshot[];
  readonly confirmation: CmdFlowConfirmationSnapshot | null;
  readonly rankingReady: boolean;
  readonly destroyed: boolean;
}

/** @deprecated Use {@link CmdFlowViewSnapshot}. */
export type ViewSnapshot = CmdFlowViewSnapshot;
/** @deprecated Use {@link CmdFlowActionSnapshot}. */
export type ActionSnapshot = CmdFlowActionSnapshot;
/** @deprecated Use {@link CmdFlowResolvedItem}. */
export type ResolvedItem<TData = unknown> = CmdFlowResolvedItem<TData>;
/** @deprecated Use {@link CmdFlowSourceSnapshot}. */
export type SourceSnapshot = CmdFlowSourceSnapshot;
/** @deprecated Use {@link CmdFlowFormSnapshot}. */
export type FormSnapshot = CmdFlowFormSnapshot;
/** @deprecated Use {@link CmdFlowFrameSnapshot}. */
export type FrameSnapshot<TData = unknown> = CmdFlowFrameSnapshot<TData>;
/** @deprecated Use {@link CmdFlowExecutionSnapshot}. */
export type ExecutionSnapshot = CmdFlowExecutionSnapshot;
/** @deprecated Use {@link CmdFlowConfirmationSnapshot}. */
export type ConfirmationSnapshot = CmdFlowConfirmationSnapshot;
