import type { RankingScope } from "../ranking-types.js";
import type {
  CandidateId,
  CmdFlowAvailability,
  CmdFlowKeybinding,
  CmdFlowSurface,
} from "./primitives.js";
import type { CmdFlowFrameSnapshot, CmdFlowResolvedItem } from "./snapshots.js";

export type CmdFlowFieldValue = string | number | boolean | readonly string[];
export type CmdFlowFormValues = Readonly<Record<string, CmdFlowFieldValue>>;

export interface CmdFlowActionEvaluation<TContext = unknown, TData = unknown> {
  readonly appContext: TContext;
  readonly frame: CmdFlowFrameSnapshot<TData>;
  readonly item: CmdFlowResolvedItem<TData> | null;
  readonly selection: readonly CandidateId[];
  readonly surface: CmdFlowSurface;
}

export interface CmdFlowActionRunInput<TContext = unknown, TData = unknown>
  extends CmdFlowActionEvaluation<TContext, TData> {
  readonly signal: AbortSignal;
  readonly executionId: string;
  readonly values: CmdFlowFormValues;
}

export type CmdFlowActionOutcome<TContext = unknown, TData = unknown> =
  | { readonly type: "stay" }
  | { readonly type: "close"; readonly target?: "shell" | "actions" }
  | { readonly type: "pop-view"; readonly target?: CmdFlowSurface | "origin" }
  | {
      readonly type: "push-view" | "replace-view";
      readonly target?: CmdFlowSurface | "origin";
      readonly view: CmdFlowViewDefinition<TContext, TData>;
    };

export interface CmdFlowActionMetadata<TContext = unknown, TData = unknown> {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly keywords?: readonly string[];
  readonly shortcut?: CmdFlowKeybinding;
  readonly section?: string;
  readonly destructive?: boolean;
  readonly priority?: "primary" | "secondary" | "auxiliary";
  readonly lifecycle?: "origin-bound" | "detached";
  readonly learn?: boolean;
  readonly visible?: (input: CmdFlowActionEvaluation<TContext, TData>) => boolean;
  readonly enabled?: (input: CmdFlowActionEvaluation<TContext, TData>) => CmdFlowAvailability;
}

export interface CmdFlowRunActionDefinition<TContext = unknown, TData = unknown>
  extends CmdFlowActionMetadata<TContext, TData> {
  readonly type: "run";
  readonly run: (input: CmdFlowActionRunInput<TContext, TData>) =>
    | void
    | CmdFlowActionOutcome<TContext, TData>
    // biome-ignore lint/suspicious/noConfusingVoidType: Async action handlers intentionally support Promise<void>.
    | Promise<void | CmdFlowActionOutcome<TContext, TData>>;
}

export interface CmdFlowSubmenuActionDefinition<TContext = unknown, TData = unknown>
  extends CmdFlowActionMetadata<TContext, TData> {
  readonly type: "submenu";
  readonly actions: readonly CmdFlowActionDefinition<TContext, TData>[];
}

export interface CmdFlowViewActionDefinition<TContext = unknown, TData = unknown>
  extends CmdFlowActionMetadata<TContext, TData> {
  readonly type: "view";
  readonly view: CmdFlowViewDefinition<TContext, TData>;
  readonly target?: CmdFlowSurface | "origin";
}

export type CmdFlowActionDefinition<TContext = unknown, TData = unknown> =
  | CmdFlowRunActionDefinition<TContext, TData>
  | CmdFlowSubmenuActionDefinition<TContext, TData>
  | CmdFlowViewActionDefinition<TContext, TData>;

export interface CmdFlowCommandDefinition<TContext = unknown, TData = unknown> {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly keywords?: readonly string[];
  readonly shortcut?: CmdFlowKeybinding;
  readonly section?: string;
  readonly aliases?: readonly string[];
  readonly data?: TData;
  readonly providerRank?: number;
  readonly favorite?: number;
  readonly contextTier?: number;
  readonly allowFallback?: boolean;
  readonly personalize?: boolean;
  readonly disabled?: CmdFlowAvailability;
  readonly visible?: (input: CmdFlowActionEvaluation<TContext, TData>) => boolean;
  readonly enabled?: (input: CmdFlowActionEvaluation<TContext, TData>) => CmdFlowAvailability;
  /** Default behavior used when the command is invoked directly. */
  readonly action?: CmdFlowActionDefinition<TContext, TData>;
  /** Contextual actions shown in the action surface. */
  readonly actions?: readonly CmdFlowActionDefinition<TContext, TData>[];
}

interface CmdFlowFormFieldBase<TContext, TData, TValue extends CmdFlowFieldValue> {
  readonly id: string;
  readonly label: string;
  readonly defaultValue?: TValue;
  readonly required?: boolean;
  readonly sensitive?: boolean;
  readonly validate?: (
    value: TValue,
    input: CmdFlowActionRunInput<TContext, TData>,
  ) => string | undefined | Promise<string | undefined>;
}

export interface CmdFlowTextField<TContext = unknown, TData = unknown>
  extends CmdFlowFormFieldBase<TContext, TData, string> {
  readonly type: "text" | "password" | "email" | "textarea";
  readonly options?: never;
}

export interface CmdFlowNumberField<TContext = unknown, TData = unknown>
  extends CmdFlowFormFieldBase<TContext, TData, number> {
  readonly type: "number";
  readonly options?: never;
}

export interface CmdFlowCheckboxField<TContext = unknown, TData = unknown>
  extends CmdFlowFormFieldBase<TContext, TData, boolean> {
  readonly type: "checkbox";
  readonly options?: never;
}

export interface CmdFlowSelectOption {
  readonly value: string;
  readonly label: string;
}

export interface CmdFlowSelectField<TContext = unknown, TData = unknown>
  extends CmdFlowFormFieldBase<TContext, TData, string> {
  readonly type: "select";
  readonly options: readonly CmdFlowSelectOption[];
}

export interface CmdFlowMultiSelectField<TContext = unknown, TData = unknown>
  extends CmdFlowFormFieldBase<TContext, TData, readonly string[]> {
  readonly type: "multi-select";
  readonly options: readonly CmdFlowSelectOption[];
}

export type CmdFlowFormField<TContext = unknown, TData = unknown> =
  | CmdFlowTextField<TContext, TData>
  | CmdFlowNumberField<TContext, TData>
  | CmdFlowCheckboxField<TContext, TData>
  | CmdFlowSelectField<TContext, TData>
  | CmdFlowMultiSelectField<TContext, TData>;

interface CmdFlowViewBase<TContext, TData> {
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  readonly actions?: readonly CmdFlowActionDefinition<TContext, TData>[];
  readonly renderer?: CmdFlowRendererDescriptor;
}

export interface CmdFlowRendererDescriptor<TPayload = unknown> {
  readonly key: string;
  readonly payload?: TPayload;
}

export interface CmdFlowListViewDefinition<TContext = unknown, TData = unknown>
  extends CmdFlowViewBase<TContext, TData> {
  readonly type: "list";
  readonly items?: readonly CmdFlowCommandDefinition<TContext, TData>[];
  readonly sourceIds?: readonly string[];
  readonly selectionMode?: "none" | "single" | "multiple";
  readonly learnableQuery?: boolean;
  readonly rankingContextKey?: string;
  readonly fields?: never;
  readonly submit?: never;
}

export interface CmdFlowDetailViewDefinition<TContext = unknown, TData = unknown>
  extends CmdFlowViewBase<TContext, TData> {
  readonly type: "detail";
  readonly items?: never;
  readonly sourceIds?: never;
  readonly selectionMode?: never;
  readonly learnableQuery?: never;
  readonly rankingContextKey?: string;
  readonly fields?: never;
  readonly submit?: never;
}

export interface CmdFlowFormViewDefinition<TContext = unknown, TData = unknown>
  extends CmdFlowViewBase<TContext, TData> {
  readonly type: "form";
  readonly fields: readonly CmdFlowFormField<TContext, TData>[];
  readonly submit: CmdFlowRunActionDefinition<TContext, TData>;
  readonly items?: never;
  readonly sourceIds?: never;
  readonly selectionMode?: never;
  readonly learnableQuery?: never;
  readonly rankingContextKey?: string;
}

export interface CmdFlowCustomViewDefinition<TContext = unknown, TData = unknown>
  extends CmdFlowViewBase<TContext, TData> {
  readonly type: "custom";
  readonly renderer: CmdFlowRendererDescriptor;
  readonly items?: never;
  readonly sourceIds?: never;
  readonly selectionMode?: never;
  readonly learnableQuery?: never;
  readonly rankingContextKey?: string;
  readonly fields?: never;
  readonly submit?: never;
}

export type CmdFlowViewDefinition<TContext = unknown, TData = unknown> =
  | CmdFlowListViewDefinition<TContext, TData>
  | CmdFlowDetailViewDefinition<TContext, TData>
  | CmdFlowFormViewDefinition<TContext, TData>
  | CmdFlowCustomViewDefinition<TContext, TData>;

export interface CmdFlowSearchRequest<TContext = unknown> {
  readonly rawQuery: string;
  readonly normalizedQuery: string;
  readonly normalizationVersion: string;
  readonly context: TContext;
  readonly scope: RankingScope;
  readonly cursor?: string;
  readonly signal: AbortSignal;
}

export type CmdFlowBatchMutation<TContext = unknown, TData = unknown> =
  | {
      readonly operation: "replace";
      readonly items: readonly CmdFlowCommandDefinition<TContext, TData>[];
    }
  | {
      readonly operation: "patch";
      readonly items: readonly CmdFlowCommandDefinition<TContext, TData>[];
      readonly remove?: readonly string[];
    };

export type CmdFlowFinalResultBatch<TContext = unknown, TData = unknown> = CmdFlowBatchMutation<
  TContext,
  TData
> & {
  readonly done: true;
  readonly nextCursor?: string;
};

export type CmdFlowResultBatch<TContext = unknown, TData = unknown> =
  | CmdFlowFinalResultBatch<TContext, TData>
  | (CmdFlowBatchMutation<TContext, TData> & {
      readonly done: false;
      readonly nextCursor?: never;
    });

export interface CmdFlowResultSource<TContext = unknown, TData = unknown> {
  readonly id: string;
  readonly sourcePriority?: number;
  readonly debounceMs?: number;
  readonly minQueryLength?: number;
  readonly limit?: number;
  readonly remoteQuery?: "raw" | "normalized" | "none";
  readonly search: (
    request: CmdFlowSearchRequest<TContext>,
  ) =>
    | CmdFlowFinalResultBatch<TContext, TData>
    | Promise<CmdFlowFinalResultBatch<TContext, TData>>
    | AsyncIterable<CmdFlowResultBatch<TContext, TData>>;
}

export interface CmdFlowExtensionDefinition<TContext = unknown, TData = unknown> {
  readonly id: string;
  readonly commands?: readonly CmdFlowCommandDefinition<TContext, TData>[];
  readonly sources?: readonly CmdFlowResultSource<TContext, TData>[];
}

/** @deprecated Use {@link CmdFlowActionEvaluation}. */
export type ActionEvaluation<TContext, TData = unknown> = CmdFlowActionEvaluation<TContext, TData>;
/** @deprecated Use {@link CmdFlowActionRunInput}. */
export type ActionRunInput<TContext, TData = unknown> = CmdFlowActionRunInput<TContext, TData>;
/** @deprecated Use {@link CmdFlowActionOutcome}. */
export type ActionOutcome<TContext = unknown, TData = unknown> = CmdFlowActionOutcome<
  TContext,
  TData
>;
/** @deprecated Use {@link CmdFlowActionDefinition}. */
export type ActionDefinition<TContext = unknown, TData = unknown> = CmdFlowActionDefinition<
  TContext,
  TData
>;
/** @deprecated Use {@link CmdFlowCommandDefinition}. */
export type CommandDefinition<TContext = unknown, TData = unknown> = CmdFlowCommandDefinition<
  TContext,
  TData
>;
/** @deprecated Use {@link CmdFlowFieldValue}. */
export type FieldValue = CmdFlowFieldValue;
/** @deprecated Use {@link CmdFlowFormField}. */
export type FormField<TContext = unknown, TData = unknown> = CmdFlowFormField<TContext, TData>;
/** @deprecated Use {@link CmdFlowViewDefinition}. */
export type ViewDefinition<TContext = unknown, TData = unknown> = CmdFlowViewDefinition<
  TContext,
  TData
>;
/** @deprecated Use {@link CmdFlowSearchRequest}. */
export type SearchRequest<TContext> = CmdFlowSearchRequest<TContext>;
/** @deprecated Use {@link CmdFlowBatchMutation}. */
export type BatchMutation<TContext, TData = unknown> = CmdFlowBatchMutation<TContext, TData>;
/** @deprecated Use {@link CmdFlowFinalResultBatch}. */
export type FinalResultBatch<TContext, TData = unknown> = CmdFlowFinalResultBatch<TContext, TData>;
/** @deprecated Use {@link CmdFlowResultBatch}. */
export type ResultBatch<TContext, TData = unknown> = CmdFlowResultBatch<TContext, TData>;
/** @deprecated Use {@link CmdFlowResultSource}. */
export type ResultSource<TContext = unknown, TData = unknown> = CmdFlowResultSource<
  TContext,
  TData
>;
/** @deprecated Use {@link CmdFlowExtensionDefinition}. */
export type ExtensionDefinition<TContext = unknown, TData = unknown> = CmdFlowExtensionDefinition<
  TContext,
  TData
>;
