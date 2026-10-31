import type {
  CmdFlowActionDefinition as ActionDefinition,
  CmdFlowCommandDefinition as CommandDefinition,
  CmdFlowResultBatch as ResultBatch,
  CmdFlowResultSource as ResultSource,
  CmdFlowViewDefinition as ViewDefinition,
} from "../contracts/definitions.js";
import type { CandidateId, CmdFlowSurface as Surface } from "../contracts/primitives.js";
import type {
  CmdFlowFormSnapshot as FormSnapshot,
  CmdFlowFrameSnapshot as FrameSnapshot,
  CmdFlowResolvedItem as ResolvedItem,
  CmdFlowSourceSnapshot as SourceSnapshot,
} from "../contracts/snapshots.js";
import type { RankExplanation, RankingQueryKey } from "../ranking-types.js";

export interface SourceState<TContext, TData = unknown> {
  definition: ResultSource<TContext, TData>;
  items: Map<string, CommandDefinition<TContext, TData>>;
  snapshot: SourceSnapshot;
  controller?: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  pageId: number;
  iterator?: AsyncIterator<ResultBatch<TContext, TData>>;
}

export interface Frame<TContext, TData = unknown> {
  id: string;
  surface: Surface;
  definition: ViewDefinition<TContext, TData>;
  query: string;
  committedQuery: string;
  composing: boolean;
  activeId: CandidateId | null;
  selectedIds: CandidateId[];
  sources: Map<string, SourceState<TContext, TData>>;
  scrollAnchor: FrameSnapshot<TData>["scrollAnchor"];
  form: FormSnapshot;
  snapshot: FrameSnapshot<TData>;
  candidates: Map<CandidateId, CommandDefinition<TContext, TData>>;
  staticItems: Map<
    CandidateId,
    {
      command: CommandDefinition<TContext, TData>;
      sourcePriority: number;
      item: ResolvedItem<TData>;
    }
  >;
  actionOrigin?: { frameId: string; candidateId?: CandidateId };
  navigationRevision: number;
  formVersion: number;
  validation?: AbortController;
  queryKey?: RankingQueryKey;
  queryKeyGeneration: number;
  rankExplanations: readonly RankExplanation[];
}

export interface RunningExecution<TContext, TData = unknown> {
  controller: AbortController;
  frame: Frame<TContext, TData>;
  session: number;
  action: ActionDefinition<TContext, TData>;
  candidateId?: CandidateId;
  mainId: string;
  actionsId?: string;
  owner?: {
    command?: CommandDefinition<TContext, TData>;
    source?: ResultSource<TContext, TData>;
  };
  allowUi: boolean;
}
