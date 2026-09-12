import type {
  FeedbackCommit,
  MatchableItem,
  MatchResult,
  MemoryRankingStoreOptions,
  RankExplanation,
  RankedItems,
  RankingComparisonKeyV1,
  RankingInvalidationListener,
  RankingItem,
  RankingProfile,
  RankingQueryKey,
  RankingQueryPolicy,
  RankingRecord,
  RankingResetSelector,
  RankingScope,
  RankingStore,
  RankOptions,
} from "./ranking-types.js";

export const RANKING_VERSION = 1;
export const QUERY_NORMALIZATION_VERSION = "nfkc-v1";
export const VALUE_SCALE = 1_000;
export const VALUE_MAX = 10_000;
export const DAY_MS = 86_400_000;
export const RETENTION_DAYS = 180;
export const FUTURE_SKEW_MS = 300_000;
const MIN_RETAINED_VALUE = 100;

export function normalizeQueryV1(input: string): string {
  return input.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function roundHalfUp(value: number, divisor: number): number {
  return Math.floor((value + Math.floor(divisor / 2)) / divisor);
}

export function decayFrecencyV1(value: number, elapsedWholeDays: number): number {
  let next = Number.isSafeInteger(value) ? Math.max(0, Math.min(VALUE_MAX, value)) : 0;
  const days = Number.isSafeInteger(elapsedWholeDays)
    ? Math.max(0, Math.min(RETENTION_DAYS, elapsedWholeDays))
    : 0;
  for (let day = 0; day < days; day += 1) next = roundHalfUp(next * 9_750, 10_000);
  return next;
}

export function recordSuccessfulUseV1(value: number, elapsedWholeDays: number): number {
  return Math.min(
    VALUE_MAX,
    roundHalfUp(decayFrecencyV1(value, elapsedWholeDays) * 9, 10) + VALUE_SCALE,
  );
}

function requireNow(now: number): void {
  if (!Number.isSafeInteger(now))
    throw new TypeError("Ranking time must be a finite safe integer.");
}

function validScope(scope: RankingScope): boolean {
  return (
    typeof scope?.subjectKey === "string" &&
    typeof scope.surfaceId === "string" &&
    (scope.contextKey === undefined || typeof scope.contextKey === "string")
  );
}

function validQueryKey(key: RankingQueryKey | undefined): key is RankingQueryKey {
  return (
    key != null &&
    typeof key.value === "string" &&
    (key.strategy === "plain" ||
      (key.strategy === "fingerprint" &&
        typeof key.fingerprintKeyId === "string" &&
        key.fingerprintKeyId.length > 0))
  );
}

function queryIdentity(key: RankingQueryKey | undefined): string | undefined {
  if (!validQueryKey(key)) return undefined;
  return JSON.stringify([
    key.strategy,
    key.strategy === "fingerprint" ? key.fingerprintKeyId : null,
    key.value,
  ]);
}

/** Pure-core hook: fingerprint cryptography is supplied by the host/browser adapter. */
export async function deriveRankingQueryKey(
  query: string,
  scope: RankingScope,
  policy: RankingQueryPolicy,
): Promise<RankingQueryKey | undefined> {
  if (!validScope(scope)) throw new TypeError("Invalid ranking scope.");
  const normalized = normalizeQueryV1(query);
  if (policy.strategy === "none" || normalized.length === 0) return undefined;
  if (policy.strategy === "plain") return Object.freeze({ strategy: "plain", value: normalized });
  if (!policy.fingerprintKeyId) throw new TypeError("A fingerprint key ID is required.");
  const input = JSON.stringify([
    "cmdflow-ranking",
    RANKING_VERSION,
    QUERY_NORMALIZATION_VERSION,
    scope.subjectKey,
    scope.surfaceId,
    "exact-query",
    normalized,
  ]);
  const value = await policy.fingerprint(input);
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Fingerprint derivation must return a non-empty string.");
  }
  return Object.freeze({
    strategy: "fingerprint",
    value,
    fingerprintKeyId: policy.fingerprintKeyId,
  });
}

function words(input: string): string[] {
  return input.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function ratio(numerator: number, denominator: number): number {
  return Math.floor((numerator * 100) / Math.max(1, denominator));
}

function prefixQuality(query: string, text: string): number {
  return 900 + ratio(Array.from(query).length, Array.from(text).length);
}

function fuzzyQuality(query: string, text: string): number | null {
  const needle = Array.from(query);
  const haystack = Array.from(text);
  let cursor = 0;
  let first = -1;
  let last = -1;
  for (const character of needle) {
    const at = haystack.indexOf(character, cursor);
    if (at < 0) return null;
    if (first === -1) first = at;
    last = at;
    cursor = at + 1;
  }
  if (first < 0) return 0;
  const compactness = ratio(needle.length, last - first + 1);
  const coverage = ratio(needle.length, haystack.length);
  const start = ratio(haystack.length - first, haystack.length);
  return compactness * 6 + coverage * 3 + start;
}

function tokenPrefixMatch(query: string, title: string): boolean {
  const queryWords = words(query);
  const titleWords = words(title);
  if (queryWords.length === 0) return false;
  let cursor = 0;
  for (const word of queryWords) {
    const index = titleWords.findIndex(
      (candidate, at) => at >= cursor && candidate.startsWith(word),
    );
    if (index < 0) return false;
    cursor = index + 1;
  }
  return true;
}

/** The fixed v1 tiers and 100-point quality bands are part of the ranking contract. */
export function matchItem(rawQuery: string, item: MatchableItem): MatchResult | null {
  const query = normalizeQueryV1(rawQuery);
  if (!query) return { tier: 0, quality: 0 };
  const title = normalizeQueryV1(item.title);
  const aliases = item.aliases?.map(normalizeQueryV1) ?? [];
  if (aliases.includes(query)) return { tier: 0, quality: 1_000 };
  const aliasPrefixes = aliases.filter((alias) => alias.startsWith(query));
  if (aliasPrefixes.length > 0) {
    return {
      tier: 1,
      quality: Math.max(...aliasPrefixes.map((alias) => prefixQuality(query, alias))),
    };
  }
  if (title === query) return { tier: 2, quality: 1_000 };
  if (title.startsWith(query)) return { tier: 3, quality: prefixQuality(query, title) };
  const acronym = words(title)
    .map((word) => Array.from(word)[0] ?? "")
    .join("");
  if (acronym.startsWith(query))
    return { tier: 3, quality: 850 + ratio(query.length, acronym.length) };
  if (tokenPrefixMatch(query, title)) {
    return { tier: 3, quality: 800 + ratio(Array.from(query).length, Array.from(title).length) };
  }
  const titleQuality = fuzzyQuality(query, title);
  if (titleQuality !== null) return { tier: 4, quality: titleQuality };
  const metadata = [...(item.keywords ?? []), item.subtitle ?? ""].map(normalizeQueryV1);
  if (metadata.includes(query)) return { tier: 5, quality: 1_000 };
  const metadataPrefixes = metadata.filter((text) => text.startsWith(query));
  if (metadataPrefixes.length > 0) {
    return {
      tier: 5,
      quality: Math.max(...metadataPrefixes.map((text) => prefixQuality(query, text))),
    };
  }
  const metadataMatches = metadata
    .map((text) => fuzzyQuality(query, text))
    .filter((quality): quality is number => quality !== null);
  if (metadataMatches.length > 0) return { tier: 6, quality: Math.max(...metadataMatches) };
  return null;
}

function codeUnitOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function safeInteger(value: number | undefined, fallback = 0): number {
  return value !== undefined && Number.isSafeInteger(value) ? value : fallback;
}

function ordinal(value: number | undefined): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** A total order; malformed feature values use the finite default zero. */
export function compareRankingKeysV1(
  left: RankingComparisonKeyV1,
  right: RankingComparisonKeyV1,
): number {
  const length = Math.max(left.features.length, right.features.length);
  for (let at = 0; at < length; at += 1) {
    const a = safeInteger(left.features[at]);
    const b = safeInteger(right.features[at]);
    if (a !== b) return a < b ? -1 : 1;
  }
  return codeUnitOrder(left.candidateId, right.candidateId);
}

function recordKey(record: RankingRecord): string {
  return JSON.stringify([
    record.scope.subjectKey,
    record.scope.surfaceId,
    record.kind,
    record.scope.contextKey ?? null,
    queryIdentity(record.queryKey) ?? null,
    record.candidateId,
  ]);
}

/** Validate and decay imported data. This never modifies a storage-owned record. */
export function sanitizeRankingRecord(
  record: RankingRecord,
  now: number,
): RankingRecord | undefined {
  requireNow(now);
  if (
    record?.version !== RANKING_VERSION ||
    !validScope(record.scope) ||
    typeof record.candidateId !== "string" ||
    !["query-context", "query-surface", "item-context", "item-surface"].includes(record.kind) ||
    !Number.isSafeInteger(record.value) ||
    record.value < 0 ||
    record.value > VALUE_MAX ||
    !Number.isSafeInteger(record.lastUsedAt) ||
    !Number.isSafeInteger(record.decayedThroughDay)
  ) {
    return undefined;
  }
  const isQuery = record.kind.startsWith("query-");
  const isContext = record.kind.endsWith("-context");
  if (isQuery !== validQueryKey(record.queryKey)) return undefined;
  if (isContext !== (record.scope.contextKey !== undefined)) return undefined;
  if (record.lastUsedAt > now + FUTURE_SKEW_MS) return undefined;
  const lastUsedAt = Math.min(record.lastUsedAt, now);
  if (now - lastUsedAt >= RETENTION_DAYS * DAY_MS) return undefined;
  const currentDay = Math.floor(now / DAY_MS);
  const previousDay = Math.min(currentDay, record.decayedThroughDay);
  const value = decayFrecencyV1(record.value, Math.min(RETENTION_DAYS, currentDay - previousDay));
  return {
    ...record,
    scope: { ...record.scope },
    queryKey: record.queryKey ? { ...record.queryKey } : undefined,
    value,
    lastUsedAt,
    decayedThroughDay: currentDay,
  };
}

type Affinity = {
  contextQuery: number;
  surfaceQuery: number;
  contextItem: number;
  surfaceItem: number;
};

function affinities(options: RankOptions): Map<string, Affinity> {
  const result = new Map<string, Affinity>();
  const scope = options.scope;
  if (
    !scope ||
    options.profile?.version !== RANKING_VERSION ||
    !Array.isArray(options.profile.records)
  ) {
    return result;
  }
  const key = queryIdentity(options.queryKey);
  for (const raw of options.profile.records) {
    const record = sanitizeRankingRecord(raw, options.now);
    if (
      !record ||
      record.scope.subjectKey !== scope.subjectKey ||
      record.scope.surfaceId !== scope.surfaceId ||
      (record.scope.contextKey !== undefined && record.scope.contextKey !== scope.contextKey)
    ) {
      continue;
    }
    const query = record.kind.startsWith("query-");
    if (query && (key === undefined || queryIdentity(record.queryKey) !== key)) continue;
    const values = result.get(record.candidateId) ?? {
      contextQuery: 0,
      surfaceQuery: 0,
      contextItem: 0,
      surfaceItem: 0,
    };
    const field = {
      "query-context": "contextQuery",
      "query-surface": "surfaceQuery",
      "item-context": "contextItem",
      "item-surface": "surfaceItem",
    } as const;
    // Corrupt duplicate records never multiply feedback or depend on input order.
    values[field[record.kind]] = Math.max(values[field[record.kind]], record.value);
    result.set(record.candidateId, values);
  }
  return result;
}

export function rankItems<T extends RankingItem>(
  items: readonly T[],
  options: RankOptions,
): RankedItems<T> {
  requireNow(options.now);
  const query = normalizeQueryV1(options.query);
  const learned = affinities(options);
  const excluded: RankExplanation[] = [];
  const ranked: { item: T; key: number[]; explanation: RankExplanation }[] = [];
  for (const item of items) {
    const match = matchItem(query, item) ?? (item.allowFallback ? { tier: 7, quality: 0 } : null);
    const sourcePriority = safeInteger(item.sourcePriority);
    const providerRank = ordinal(item.providerRank);
    if (!match) {
      excluded.push({
        candidateId: item.candidateId,
        eligible: false,
        policyTier: "excluded",
        relevanceBand: "unmatched",
        lexicalScoreFixed: 0,
        exactContextAffinityFixed: 0,
        exactSurfaceAffinityFixed: 0,
        contextFrecencyFixed: 0,
        globalFrecencyFixed: 0,
        sourcePriority,
        providerRank,
        reason: "No lexical match and provider fallback is disabled.",
        finalOrder: -1,
      });
      continue;
    }
    const values = item.personalize === false ? undefined : learned.get(item.candidateId);
    const favorite = query.length === 0 ? ordinal(item.favoriteOrder ?? item.favorite) : undefined;
    const contextTier = Math.max(0, Math.min(15, safeInteger(item.contextTier)));
    const qualityBand = Math.floor(match.quality / 100);
    const policyTier = favorite === undefined ? "default" : `favorite:${favorite}`;
    const explanation: RankExplanation = {
      candidateId: item.candidateId,
      eligible: true,
      policyTier,
      relevanceBand: `${match.tier}:${qualityBand}:${contextTier}`,
      lexicalScoreFixed: match.quality,
      exactContextAffinityFixed: values?.contextQuery ?? 0,
      exactSurfaceAffinityFixed: values?.surfaceQuery ?? 0,
      contextFrecencyFixed: values?.contextItem ?? 0,
      globalFrecencyFixed: values?.surfaceItem ?? 0,
      sourcePriority,
      providerRank,
      reason: `Match tier ${match.tier}, quality band ${qualityBand}, context tier ${contextTier}; personalization is bounded by this band.`,
      finalOrder: -1,
    };
    ranked.push({
      item,
      key: [
        favorite === undefined ? 1 : 0,
        favorite ?? 0,
        match.tier,
        -qualityBand,
        contextTier,
        -(values?.contextQuery ?? 0),
        -(values?.surfaceQuery ?? 0),
        -(values?.contextItem ?? 0),
        -(values?.surfaceItem ?? 0),
        -match.quality,
        sourcePriority,
        // Presence is explicit to keep mixed ranked/unranked candidates a total order.
        providerRank === undefined ? 1 : 0,
        providerRank ?? 0,
      ],
      explanation,
    });
  }
  ranked.sort((a, b) =>
    compareRankingKeysV1(
      { features: a.key, candidateId: a.item.candidateId },
      { features: b.key, candidateId: b.item.candidateId },
    ),
  );
  excluded.sort((a, b) => codeUnitOrder(a.candidateId, b.candidateId));
  return {
    items: ranked.map(({ item }) => item),
    explanations: [
      ...ranked.map(({ explanation }, finalOrder) => ({ ...explanation, finalOrder })),
      ...excluded,
    ],
  };
}

function frozenProfile(revision: number, records: readonly RankingRecord[]): RankingProfile {
  return Object.freeze({
    version: 1,
    revision,
    records: Object.freeze(
      records.map((record) =>
        Object.freeze({
          ...record,
          scope: Object.freeze({ ...record.scope }),
          queryKey: record.queryKey ? Object.freeze({ ...record.queryKey }) : undefined,
        }),
      ),
    ),
  });
}

function matchesReset(record: RankingRecord, selector: RankingResetSelector): boolean {
  if (selector.subjectKey !== undefined && record.scope.subjectKey !== selector.subjectKey)
    return false;
  if (selector.type === "all") return true;
  if (selector.type === "fingerprint") {
    return (
      record.queryKey?.strategy === "fingerprint" &&
      record.queryKey.fingerprintKeyId === selector.fingerprintKeyId
    );
  }
  if (selector.surfaceId !== undefined && record.scope.surfaceId !== selector.surfaceId)
    return false;
  if (selector.type === "surface") return true;
  if (selector.type === "item") return record.candidateId === selector.candidateId;
  return queryIdentity(record.queryKey) === queryIdentity(selector.queryKey);
}

/** An isolated, ephemeral store. All mutations complete synchronously before promises resolve. */
export function createMemoryRankingStore(options: MemoryRankingStoreOptions = {}): RankingStore {
  const records = new Map<string, RankingRecord>();
  const operations = new Map<string, number>();
  const listeners = new Set<RankingInvalidationListener>();
  const maxRecords = Math.max(1, ordinal(options.maxRecords) ?? 5_000);
  const clock = options.now ?? Date.now;
  let revision = 0;

  function invalidate(namespaces: Set<string>): void {
    if (namespaces.size === 0) return;
    revision += 1;
    for (const namespace of namespaces) {
      for (const listener of listeners) {
        try {
          listener({ namespace, revision });
        } catch {
          // Observer failures cannot roll back or reject an already committed mutation.
        }
      }
    }
  }

  function prune(now: number): Set<string> {
    const changed = new Set<string>();
    const bySubject = new Map<string, RankingRecord[]>();
    for (const [key, raw] of records) {
      const record = sanitizeRankingRecord(raw, now);
      if (!record || record.value < MIN_RETAINED_VALUE) {
        records.delete(key);
        changed.add(raw.scope.subjectKey);
        continue;
      }
      if (
        raw.value !== record.value ||
        raw.lastUsedAt !== record.lastUsedAt ||
        raw.decayedThroughDay !== record.decayedThroughDay
      ) {
        records.set(key, record);
        changed.add(record.scope.subjectKey);
      }
      const subjectRecords = bySubject.get(record.scope.subjectKey) ?? [];
      subjectRecords.push(record);
      bySubject.set(record.scope.subjectKey, subjectRecords);
    }
    for (const [subject, subjectRecords] of bySubject) {
      if (subjectRecords.length <= maxRecords) continue;
      subjectRecords.sort((a, b) => {
        if (a.value !== b.value) return a.value < b.value ? -1 : 1;
        if (a.lastUsedAt !== b.lastUsedAt) return a.lastUsedAt < b.lastUsedAt ? -1 : 1;
        return codeUnitOrder(recordKey(a), recordKey(b));
      });
      for (const record of subjectRecords.slice(0, subjectRecords.length - maxRecords)) {
        records.delete(recordKey(record));
      }
      changed.add(subject);
    }
    for (const [operation, at] of operations) {
      if (now - at >= RETENTION_DAYS * DAY_MS) operations.delete(operation);
    }
    return changed;
  }

  return {
    async load(request) {
      requireNow(request.now);
      if (!validScope(request.scope)) throw new TypeError("Invalid ranking scope.");
      invalidate(prune(request.now));
      const matching = Array.from(records.values()).filter(
        (record) =>
          record.scope.subjectKey === request.scope.subjectKey &&
          record.scope.surfaceId === request.scope.surfaceId &&
          (record.scope.contextKey === undefined ||
            record.scope.contextKey === request.scope.contextKey),
      );
      matching.sort((a, b) => codeUnitOrder(recordKey(a), recordKey(b)));
      return frozenProfile(revision, matching);
    },
    async commit(commit: FeedbackCommit) {
      if (commit.learn === false) return;
      const now = clock();
      requireNow(now);
      if (!validScope(commit.scope)) throw new TypeError("Invalid ranking scope.");
      if (typeof commit.operationId !== "string" || !commit.operationId) {
        throw new TypeError("A non-empty operation ID is required.");
      }
      if (typeof commit.candidateId !== "string") throw new TypeError("Invalid candidate ID.");
      if (
        !Number.isSafeInteger(commit.occurredAt) ||
        commit.occurredAt > now + FUTURE_SKEW_MS ||
        now - commit.occurredAt >= RETENTION_DAYS * DAY_MS
      ) {
        return;
      }
      const operationKey = JSON.stringify([commit.scope.subjectKey, commit.operationId]);
      if (operations.has(operationKey)) {
        invalidate(prune(now));
        return;
      }
      const key = commit.queryKey;
      const allowKey =
        validQueryKey(key) &&
        (key.strategy !== "plain" || options.allowPlainQueryKeys === true) &&
        (options.allowQueryKey?.(key, commit.scope) ?? true);
      const changed = prune(now);
      const occurredAt = Math.min(now, commit.occurredAt);
      const scopes = [
        { subjectKey: commit.scope.subjectKey, surfaceId: commit.scope.surfaceId },
        ...(commit.scope.contextKey !== undefined ? [{ ...commit.scope }] : []),
      ];
      const additions: RankingRecord[] = [];
      for (const scope of scopes) {
        for (const queryKey of allowKey ? [undefined, key] : [undefined]) {
          const context = "contextKey" in scope;
          const kind = queryKey
            ? context
              ? "query-context"
              : "query-surface"
            : context
              ? "item-context"
              : "item-surface";
          const base: RankingRecord = {
            version: 1,
            kind,
            scope,
            candidateId: commit.candidateId,
            queryKey,
            value: 0,
            decayedThroughDay: Math.floor(now / DAY_MS),
            lastUsedAt: occurredAt,
          };
          const previous = records.get(recordKey(base));
          additions.push({
            ...base,
            value: recordSuccessfulUseV1(previous?.value ?? 0, 0),
            lastUsedAt: Math.max(occurredAt, previous?.lastUsedAt ?? occurredAt),
          });
        }
      }
      // No user callback or await occurs between the first aggregate and operation tombstone.
      for (const record of additions) records.set(recordKey(record), record);
      operations.set(operationKey, occurredAt);
      changed.add(commit.scope.subjectKey);
      for (const subject of prune(now)) changed.add(subject);
      invalidate(changed);
    },
    async reset(selector) {
      const changed = new Set<string>();
      for (const [key, record] of records) {
        if (matchesReset(record, selector)) {
          records.delete(key);
          changed.add(record.scope.subjectKey);
        }
      }
      // Keep bounded-lifetime operation tombstones: replaying a reset operation must not relearn it.
      invalidate(changed);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Shared canonical identity and reset semantics for persistence adapters. */
export { matchesReset as matchesRankingReset, recordKey as rankingRecordKeyV1 };
