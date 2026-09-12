/** Opaque, host-supplied keys. Do not put personal data in scope identifiers. */
export interface RankingScope {
  readonly subjectKey: string;
  readonly surfaceId: string;
  readonly contextKey?: string;
}

export type RankingQueryKey =
  | { readonly strategy: "plain"; readonly value: string }
  | {
      readonly strategy: "fingerprint";
      readonly value: string;
      readonly fingerprintKeyId: string;
    };

export type RankingQueryPolicy =
  | { readonly strategy: "none" }
  | { readonly strategy: "plain" }
  | {
      readonly strategy: "fingerprint";
      readonly fingerprintKeyId: string;
      /** Receives domain-separated input. Browser adapters can inject non-extractable HMAC. */
      readonly fingerprint: (input: string) => string | Promise<string>;
    };

export type RankingRecordKind = "query-context" | "query-surface" | "item-context" | "item-surface";

export interface RankingRecord {
  readonly version: 1;
  readonly kind: RankingRecordKind;
  readonly scope: RankingScope;
  readonly candidateId: string;
  readonly queryKey?: RankingQueryKey;
  readonly value: number;
  readonly decayedThroughDay: number;
  readonly lastUsedAt: number;
}

export interface RankingProfile {
  readonly version: 1;
  readonly revision: number;
  readonly records: readonly RankingRecord[];
}

export interface RankingLoadRequest {
  readonly scope: RankingScope;
  readonly now: number;
}

/** One successful operation, committed atomically and at most once per subject/operation ID. */
export interface FeedbackCommit {
  readonly operationId: string;
  readonly candidateId: string;
  readonly scope: RankingScope;
  readonly queryKey?: RankingQueryKey;
  readonly occurredAt: number;
  readonly learn?: boolean;
}

export type RankingResetSelector =
  | { readonly type: "all"; readonly subjectKey?: string }
  | { readonly type: "surface"; readonly subjectKey: string; readonly surfaceId: string }
  | {
      readonly type: "item";
      readonly subjectKey: string;
      readonly surfaceId?: string;
      readonly candidateId: string;
    }
  | {
      readonly type: "query";
      readonly subjectKey: string;
      readonly surfaceId?: string;
      readonly queryKey: RankingQueryKey;
    }
  | {
      readonly type: "fingerprint";
      readonly subjectKey: string;
      readonly fingerprintKeyId: string;
    };

export interface RankingInvalidation {
  readonly namespace: string;
  readonly revision: number;
}

export type RankingInvalidationListener = (invalidation: RankingInvalidation) => void;

export interface RankingStore {
  load(request: RankingLoadRequest): Promise<RankingProfile>;
  commit(commit: FeedbackCommit): Promise<void>;
  reset(selector: RankingResetSelector): Promise<void>;
  subscribe?(listener: RankingInvalidationListener): () => void;
}

export interface MemoryRankingStoreOptions {
  readonly now?: () => number;
  /** Record quota per subject. Defaults to 5,000. */
  readonly maxRecords?: number;
  /** Plain query keys require explicit opt-in, even for this ephemeral adapter. */
  readonly allowPlainQueryKeys?: boolean;
  /** Additional host policy; rejected query keys still allow aggregate item learning. */
  readonly allowQueryKey?: (key: RankingQueryKey, scope: RankingScope) => boolean;
}

export interface MatchableItem {
  readonly title: string;
  readonly subtitle?: string;
  readonly keywords?: readonly string[];
  readonly aliases?: readonly string[];
}

export interface MatchResult {
  /** Lower tiers are better; exact aliases precede title and metadata matches. */
  readonly tier: number;
  /** Fixed-point lexical quality in the inclusive range 0–1,000. */
  readonly quality: number;
}

export interface RankingItem extends MatchableItem {
  readonly candidateId: string;
  readonly favoriteOrder?: number;
  /** Alias used by result definitions. favoriteOrder takes precedence when both are present. */
  readonly favorite?: number;
  /** Ordered context tier 0–15. Lower is better. */
  readonly contextTier?: number;
  readonly sourcePriority?: number;
  readonly providerRank?: number;
  readonly allowFallback?: boolean;
  readonly personalize?: boolean;
}

export interface RankOptions {
  readonly query: string;
  readonly scope?: RankingScope;
  readonly profile?: RankingProfile;
  readonly queryKey?: RankingQueryKey;
  /** One finite integer clock value shared by the entire ranking pass. */
  readonly now: number;
}

export interface RankExplanation {
  readonly candidateId: string;
  readonly eligible: boolean;
  readonly policyTier: string;
  readonly relevanceBand: string;
  readonly lexicalScoreFixed: number;
  readonly exactContextAffinityFixed: number;
  readonly exactSurfaceAffinityFixed: number;
  readonly contextFrecencyFixed: number;
  readonly globalFrecencyFixed: number;
  readonly sourcePriority: number;
  readonly providerRank?: number;
  readonly reason: string;
  /** Zero-based output index, or -1 for an excluded candidate. */
  readonly finalOrder: number;
}

export interface RankedItems<T extends RankingItem> {
  readonly items: readonly T[];
  /** In final result order, followed by excluded candidates ordered by canonical ID. */
  readonly explanations: readonly RankExplanation[];
}

/** Fixed-point ascending features, followed by a code-unit ID tiebreaker. */
export interface RankingComparisonKeyV1 {
  readonly features: readonly number[];
  readonly candidateId: string;
}
