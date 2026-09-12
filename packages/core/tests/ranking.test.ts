import { describe, expect, test } from "bun:test";
import {
  compareRankingKeysV1,
  createMemoryRankingStore,
  DAY_MS,
  decayFrecencyV1,
  deriveRankingQueryKey,
  FUTURE_SKEW_MS,
  matchItem,
  normalizeQueryV1,
  RETENTION_DAYS,
  rankItems,
  recordSuccessfulUseV1,
  sanitizeRankingRecord,
} from "../src/ranking.js";
import type {
  FeedbackCommit,
  RankingItem,
  RankingProfile,
  RankingQueryKey,
  RankingRecord,
  RankingScope,
} from "../src/ranking-types.js";

const now = 20_000 * DAY_MS;
const scope: RankingScope = {
  subjectKey: "subject-a",
  surfaceId: "commands",
  contextKey: "project-a",
};
const queryKey: RankingQueryKey = { strategy: "plain", value: "github" };

function record(overrides: Partial<RankingRecord> = {}): RankingRecord {
  return {
    version: 1,
    kind: "item-surface",
    scope: { subjectKey: scope.subjectKey, surfaceId: scope.surfaceId },
    candidateId: "chosen",
    value: 1_000,
    decayedThroughDay: Math.floor(now / DAY_MS),
    lastUsedAt: now,
    ...overrides,
  };
}

function profile(...records: RankingRecord[]): RankingProfile {
  return { version: 1, revision: 0, records };
}

function feedback(overrides: Partial<FeedbackCommit> = {}): FeedbackCommit {
  return {
    operationId: "operation-1",
    candidateId: "chosen",
    scope,
    queryKey,
    occurredAt: now,
    ...overrides,
  };
}

function ids(items: readonly RankingItem[]): string[] {
  return items.map((item) => item.candidateId);
}

describe("versioned normalization and lexical matching", () => {
  test.each([
    [" \tGithub\n  Issues ", "github issues"],
    ["\u00a0\ufeffGithub\u00a0\u00a0Issues\ufeff", "github issues"],
    ["\u200bGithub\u200b", "\u200bgithub\u200b"],
    ["I İ ı", "i i\u0307 ı"],
    ["É E\u0301", "é é"],
    ["Ｇｉｔｈｕｂ", "github"],
    ["𝔊ithub 😀", "github 😀"],
  ])("normalizes %j with defined Unicode behavior", (input, expected) => {
    expect(normalizeQueryV1(input)).toBe(expected);
  });

  test("match tiers are explicit and stable", () => {
    expect(matchItem("gh", { title: "Open repository", aliases: ["gh"] })).toEqual({
      tier: 0,
      quality: 1_000,
    });
    expect(matchItem("git", { title: "Open repository", aliases: ["github"] })?.tier).toBe(1);
    expect(matchItem("github", { title: "GitHub" })?.tier).toBe(2);
    expect(matchItem("github", { title: "GitHub issues" })?.tier).toBe(3);
    expect(matchItem("gpr", { title: "GitHub Pull Requests" })?.tier).toBe(3);
    expect(matchItem("pull req", { title: "GitHub Pull Requests" })?.tier).toBe(3);
    expect(matchItem("gthb", { title: "GitHub" })?.tier).toBe(4);
    expect(matchItem("github", { title: "Issues", keywords: ["github"] })?.tier).toBe(5);
    expect(matchItem("gthb", { title: "Issues", subtitle: "github" })?.tier).toBe(6);
    expect(matchItem("xyz", { title: "GitHub" })).toBeNull();
    expect(matchItem("", { title: "Anything" })).toEqual({ tier: 0, quality: 0 });
  });

  test("astral symbols are treated as code points in fuzzy matching", () => {
    expect(matchItem("😀b", { title: "😀 grab" })?.tier).toBe(4);
    expect(matchItem("🚀", { title: "Launch 🚀" })?.quality).toBeGreaterThan(0);
  });
});

describe("fixed-point feedback and persisted input validation", () => {
  test("published reference vectors and saturation hold", () => {
    expect(recordSuccessfulUseV1(0, 0)).toBe(1_000);
    expect(recordSuccessfulUseV1(1_000, 0)).toBe(1_900);
    expect(decayFrecencyV1(1_000, 1)).toBe(975);
    expect(recordSuccessfulUseV1(10_000, 0)).toBe(10_000);
    expect(decayFrecencyV1(-50, 0)).toBe(0);
    expect(decayFrecencyV1(Number.NaN, 1)).toBe(0);
    expect(decayFrecencyV1(Number.POSITIVE_INFINITY, 1)).toBe(0);
    expect(decayFrecencyV1(1_000, Number.POSITIVE_INFINITY)).toBe(1_000);
    expect(decayFrecencyV1(1_000, 999_999)).toBe(decayFrecencyV1(1_000, RETENTION_DAYS));
    let value = 0;
    for (let at = 0; at < 1_000; at += 1) value = recordSuccessfulUseV1(value, 0);
    expect(value).toBeLessThanOrEqual(10_000);
  });

  test("records expire at the privacy TTL even if scores remain high", () => {
    expect(
      sanitizeRankingRecord(record({ lastUsedAt: now - RETENTION_DAYS * DAY_MS }), now),
    ).toBeUndefined();
    expect(
      sanitizeRankingRecord(record({ lastUsedAt: now - RETENTION_DAYS * DAY_MS + 1 }), now),
    ).toBeDefined();
  });

  test("small future skew clamps, excessive future timestamps discard", () => {
    expect(
      sanitizeRankingRecord(record({ lastUsedAt: now + FUTURE_SKEW_MS }), now)?.lastUsedAt,
    ).toBe(now);
    expect(
      sanitizeRankingRecord(record({ lastUsedAt: now + FUTURE_SKEW_MS + 1 }), now),
    ).toBeUndefined();
    expect(
      sanitizeRankingRecord(record({ decayedThroughDay: now / DAY_MS + 20 }), now)?.value,
    ).toBe(1_000);
    for (const invalid of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      0.5,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(sanitizeRankingRecord(record({ value: invalid }), now)).toBeUndefined();
      expect(sanitizeRankingRecord(record({ lastUsedAt: invalid }), now)).toBeUndefined();
      expect(sanitizeRankingRecord(record({ decayedThroughDay: invalid }), now)).toBeUndefined();
    }
    expect(() => rankItems([], { query: "", now: Number.NaN })).toThrow(TypeError);
  });

  test("invalid aggregate shapes are not used", () => {
    expect(sanitizeRankingRecord(record({ kind: "query-surface" }), now)).toBeUndefined();
    expect(sanitizeRankingRecord(record({ kind: "item-context" }), now)).toBeUndefined();
    expect(sanitizeRankingRecord(record({ queryKey }), now)).toBeUndefined();
    expect(sanitizeRankingRecord(record({ scope }), now)).toBeUndefined();
  });
});

describe("bounded ranking", () => {
  const items: RankingItem[] = [
    { candidateId: "first", title: "GitHub issues" },
    { candidateId: "chosen", title: "GitHub notifications" },
    { candidateId: "exact", title: "GitHub" },
    { candidateId: "alias", title: "Open code", aliases: ["github"] },
  ];

  test("learning promotes an equivalent result, while exact matches retain precedence", () => {
    const result = rankItems(items, { query: "github", now, scope, profile: profile(record()) });
    expect(ids(result.items)).toEqual(["alias", "exact", "chosen", "first"]);
    expect(result.explanations.find((item) => item.candidateId === "chosen")).toMatchObject({
      eligible: true,
      globalFrecencyFixed: 1_000,
      finalOrder: 2,
    });
  });

  test("learned scores cannot cross contextual relevance bands", () => {
    const result = rankItems(
      [
        { candidateId: "chosen", title: "GitHub", contextTier: 1 },
        { candidateId: "other", title: "GitHub", contextTier: 0 },
      ],
      { query: "github", now, scope, profile: profile(record({ value: 10_000 })) },
    );
    expect(ids(result.items)).toEqual(["other", "chosen"]);
  });

  test("exact context query then surface query then context item then surface item precedence", () => {
    const candidates = ["surface", "context", "surface-query", "context-query"].map(
      (candidateId) => ({
        candidateId,
        title: "GitHub",
      }),
    );
    const learned = profile(
      record({ candidateId: "surface", value: 10_000 }),
      record({ candidateId: "context", kind: "item-context", scope, value: 9_000 }),
      record({ candidateId: "surface-query", kind: "query-surface", queryKey, value: 2_000 }),
      record({
        candidateId: "context-query",
        kind: "query-context",
        queryKey,
        scope,
        value: 1_000,
      }),
    );
    expect(
      ids(rankItems(candidates, { query: "github", scope, queryKey, now, profile: learned }).items),
    ).toEqual(["context-query", "surface-query", "context", "surface"]);
    expect(
      ids(rankItems(candidates, { query: "github", scope, now, profile: learned }).items),
    ).toEqual(["context", "surface", "context-query", "surface-query"]);
  });

  test("subject, surface, context and exact query do not leak", () => {
    const candidates = [{ candidateId: "chosen", title: "GitHub" }];
    const records = [
      record({ kind: "query-context", queryKey, scope: { ...scope, contextKey: "other" } }),
      record({ scope: { subjectKey: "other", surfaceId: scope.surfaceId } }),
      record({ scope: { subjectKey: scope.subjectKey, surfaceId: "other" } }),
      record({ kind: "query-surface", queryKey: { strategy: "plain", value: "git" } }),
    ];
    const explanation = rankItems(candidates, {
      query: "github",
      scope,
      queryKey,
      now,
      profile: profile(...records),
    }).explanations[0];
    expect(explanation).toMatchObject({
      exactContextAffinityFixed: 0,
      exactSurfaceAffinityFixed: 0,
      contextFrecencyFixed: 0,
      globalFrecencyFixed: 0,
    });
  });

  test("favorites are explicit and ordered only for an empty query", () => {
    const candidates = [
      { candidateId: "b", title: "Unrelated", favorite: 0 },
      { candidateId: "a", title: "GitHub", favoriteOrder: 2 },
      { candidateId: "c", title: "GitHub issues" },
    ];
    expect(ids(rankItems(candidates, { query: "", now }).items)).toEqual(["b", "a", "c"]);
    expect(ids(rankItems(candidates, { query: "github", now }).items)).toEqual(["a", "c"]);
  });

  test("provider fallback and personalization opt-out are explicit", () => {
    const candidates = [
      { candidateId: "first", title: "GitHub issue" },
      { candidateId: "chosen", title: "GitHub notifications", personalize: false },
      { candidateId: "allowed", title: "Other", allowFallback: true },
      { candidateId: "excluded", title: "Other" },
    ];
    const result = rankItems(candidates, {
      query: "github",
      scope,
      now,
      profile: profile(record()),
    });
    expect(ids(result.items)).toEqual(["first", "chosen", "allowed"]);
    expect(result.explanations.at(-1)).toMatchObject({
      candidateId: "excluded",
      eligible: false,
      finalOrder: -1,
    });
  });

  test("source priority, provider rank and code-unit IDs make arrival order irrelevant", () => {
    const candidates = [
      { candidateId: "é", title: "GitHub" },
      { candidateId: "a", title: "GitHub" },
      { candidateId: "z", title: "GitHub" },
      { candidateId: "b", title: "GitHub", providerRank: 2 },
      { candidateId: "c", title: "GitHub", providerRank: 0 },
      { candidateId: "d", title: "GitHub", sourcePriority: -1 },
    ];
    const expected = ["d", "c", "b", "a", "z", "é"];
    expect(ids(rankItems(candidates, { query: "github", now }).items)).toEqual(expected);
    for (let rotation = 0; rotation < candidates.length; rotation += 1) {
      const rotated = [...candidates.slice(rotation), ...candidates.slice(0, rotation)];
      expect(ids(rankItems(rotated, { query: "github", now }).items)).toEqual(expected);
      expect(ids(rankItems(rotated.reverse(), { query: "github", now }).items)).toEqual(expected);
    }
  });

  test("malformed numeric features are finite and ties are transitive across permutations", () => {
    const candidates = [
      { candidateId: "a", title: "GitHub", sourcePriority: Number.NaN },
      { candidateId: "b", title: "GitHub", providerRank: Number.POSITIVE_INFINITY },
      { candidateId: "c", title: "GitHub", providerRank: -1, contextTier: Number.NaN },
    ];
    const permutations = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    for (const permutation of permutations) {
      const result = rankItems(
        permutation.map((at) => candidates[at] as RankingItem),
        { query: "github", now },
      );
      expect(ids(result.items)).toEqual(["a", "b", "c"]);
      for (const explanation of result.explanations) {
        for (const value of Object.values(explanation)) {
          if (typeof value === "number") expect(Number.isSafeInteger(value)).toBe(true);
        }
      }
    }
  });

  test("corrupt duplicate aggregates use max rather than multiplying feedback", () => {
    const result = rankItems(items, {
      query: "github",
      scope,
      now,
      profile: profile(record({ value: 1_000 }), record({ value: 2_000 })),
    });
    expect(
      result.explanations.find((item) => item.candidateId === "chosen")?.globalFrecencyFixed,
    ).toBe(2_000);
  });

  test("comparator is directly antisymmetric and transitive with malformed features", () => {
    const keys = [
      { features: [-1, 1, 2], candidateId: "a" },
      { features: [0, Number.NaN, 2], candidateId: "b" },
      { features: [0, 0, 2], candidateId: "c" },
      { features: [0, 0, 2], candidateId: "d" },
      { features: [0, 0, 3], candidateId: "a" },
      { features: [1, -1, Number.POSITIVE_INFINITY], candidateId: "a" },
      { features: [1, Number.MAX_SAFE_INTEGER, 2], candidateId: "a" },
    ];
    for (const a of keys) {
      expect(compareRankingKeysV1(a, a)).toBe(0);
      for (const b of keys) {
        expect(compareRankingKeysV1(a, b) + compareRankingKeysV1(b, a)).toBe(0);
        for (const c of keys) {
          if (compareRankingKeysV1(a, b) <= 0 && compareRankingKeysV1(b, c) <= 0) {
            expect(compareRankingKeysV1(a, c)).toBeLessThanOrEqual(0);
          }
        }
      }
    }
  });
});

describe("memory ranking store", () => {
  test("one successful operation atomically updates four aggregates, without duplicate commits", async () => {
    const store = createMemoryRankingStore({ now: () => now, allowPlainQueryKeys: true });
    const invalidations: unknown[] = [];
    store.subscribe?.((value) => invalidations.push(value));
    await store.commit(feedback());
    const learned = await store.load({ scope, now });
    expect(learned.records).toHaveLength(4);
    expect(learned.records.every((value) => value.value === 1_000)).toBe(true);
    expect(invalidations).toEqual([{ namespace: scope.subjectKey, revision: 1 }]);
    await Promise.all([store.commit(feedback()), store.commit(feedback())]);
    expect((await store.load({ scope, now })).records).toEqual(learned.records);
    expect(invalidations).toHaveLength(1);
    expect(Object.isFrozen(learned.records)).toBe(true);
    expect(Object.isFrozen(learned.records[0]?.scope)).toBe(true);
    await store.commit(feedback({ operationId: "second" }));
    expect((await store.load({ scope, now })).records.every((value) => value.value === 1_900)).toBe(
      true,
    );
  });

  test("without context, query and item aggregates are updated once each", async () => {
    const store = createMemoryRankingStore({ now: () => now, allowPlainQueryKeys: true });
    const surfaceScope = { subjectKey: scope.subjectKey, surfaceId: scope.surfaceId };
    await store.commit(feedback({ scope: surfaceScope }));
    const result = await store.load({ scope: surfaceScope, now });
    expect(result.records.map((record) => record.kind).sort()).toEqual([
      "item-surface",
      "query-surface",
    ]);
    expect(result.records.every((record) => record.value === 1_000)).toBe(true);
  });

  test("plain retention requires opt-in and query policy can deny keys without losing item learning", async () => {
    const store = createMemoryRankingStore({ now: () => now });
    await store.commit(feedback());
    expect((await store.load({ scope, now })).records.map((record) => record.kind).sort()).toEqual([
      "item-context",
      "item-surface",
    ]);
    const privateStore = createMemoryRankingStore({
      now: () => now,
      allowPlainQueryKeys: true,
      allowQueryKey: () => false,
    });
    await privateStore.commit(feedback());
    expect((await privateStore.load({ scope, now })).records).toHaveLength(2);
  });

  test("query keys support no retention, explicit plain text and domain-separated fingerprint hooks", async () => {
    expect(await deriveRankingQueryKey(" GitHub ", scope, { strategy: "none" })).toBeUndefined();
    expect(await deriveRankingQueryKey(" GitHub ", scope, { strategy: "plain" })).toEqual(queryKey);
    expect(await deriveRankingQueryKey("   ", scope, { strategy: "plain" })).toBeUndefined();
    const inputs: string[] = [];
    const policy = {
      strategy: "fingerprint" as const,
      fingerprintKeyId: "key-1",
      fingerprint: async (value: string) => {
        inputs.push(value);
        return "opaque-digest";
      },
    };
    expect(await deriveRankingQueryKey(" GitHub ", scope, policy)).toEqual({
      strategy: "fingerprint",
      value: "opaque-digest",
      fingerprintKeyId: "key-1",
    });
    await deriveRankingQueryKey("github", { ...scope, subjectKey: "different" }, policy);
    expect(inputs[0]).not.toBe(inputs[1]);
    expect(JSON.parse(inputs[0] ?? "[]")).toEqual([
      "cmdflow-ranking",
      1,
      "nfkc-v1",
      scope.subjectKey,
      scope.surfaceId,
      "exact-query",
      "github",
    ]);
  });

  test("load isolates subjects, surfaces and other contexts", async () => {
    const store = createMemoryRankingStore({ now: () => now, allowPlainQueryKeys: true });
    await store.commit(feedback());
    expect(
      (await store.load({ scope: { ...scope, subjectKey: "other" }, now })).records,
    ).toHaveLength(0);
    expect(
      (await store.load({ scope: { ...scope, surfaceId: "other" }, now })).records,
    ).toHaveLength(0);
    expect(
      (await store.load({ scope: { ...scope, contextKey: "other" }, now })).records,
    ).toHaveLength(2);
  });

  test("reset removes all item aggregates and duplicate operation replay cannot resurrect them", async () => {
    const store = createMemoryRankingStore({ now: () => now, allowPlainQueryKeys: true });
    await store.commit(feedback());
    await store.commit(feedback({ candidateId: "other", operationId: "other" }));
    await store.reset({ type: "item", subjectKey: scope.subjectKey, candidateId: "chosen" });
    await store.commit(feedback());
    const learned = await store.load({ scope, now });
    expect(learned.records).toHaveLength(4);
    expect(learned.records.every((record) => record.candidateId === "other")).toBe(true);
    await store.reset({ type: "all" });
    expect((await store.load({ scope, now })).records).toHaveLength(0);
  });

  test("query and fingerprint rotation resets preserve aggregate item history", async () => {
    const store = createMemoryRankingStore({ now: () => now, allowPlainQueryKeys: true });
    await store.commit(feedback());
    await store.reset({ type: "query", subjectKey: scope.subjectKey, queryKey });
    expect((await store.load({ scope, now })).records).toHaveLength(2);
    await store.commit(
      feedback({
        operationId: "fingerprint",
        queryKey: { strategy: "fingerprint", fingerprintKeyId: "old-key", value: "opaque" },
      }),
    );
    expect((await store.load({ scope, now })).records).toHaveLength(4);
    await store.reset({
      type: "fingerprint",
      subjectKey: scope.subjectKey,
      fingerprintKeyId: "old-key",
    });
    expect((await store.load({ scope, now })).records).toHaveLength(2);
    await store.reset({
      type: "surface",
      subjectKey: scope.subjectKey,
      surfaceId: scope.surfaceId,
    });
    expect((await store.load({ scope, now })).records).toHaveLength(0);
  });

  test("day boundaries preserve decay even when feedback is frequent", async () => {
    let time = now + DAY_MS - 1;
    const store = createMemoryRankingStore({ now: () => time });
    await store.commit(feedback({ occurredAt: time }));
    time += 2;
    await store.commit(feedback({ operationId: "second-day", occurredAt: time }));
    expect(
      (await store.load({ scope, now: time })).records.every((record) => record.value === 1_878),
    ).toBe(true);
    expect(
      (await store.load({ scope, now: time })).records.every(
        (record) => record.decayedThroughDay === 20_001,
      ),
    ).toBe(true);
  });

  test("privacy TTL and per-subject quota prune deterministically", async () => {
    let time = now;
    const store = createMemoryRankingStore({ now: () => time, maxRecords: 2 });
    const surface = { subjectKey: scope.subjectKey, surfaceId: scope.surfaceId };
    for (const candidateId of ["b", "c", "a"]) {
      await store.commit(feedback({ scope: surface, operationId: candidateId, candidateId }));
    }
    expect(
      (await store.load({ scope, now: time })).records.map((record) => record.candidateId),
    ).toEqual(["b", "c"]);
    await store.commit(
      feedback({ scope: { ...surface, subjectKey: "other" }, operationId: "d", candidateId: "d" }),
    );
    expect((await store.load({ scope, now: time })).records).toHaveLength(2);
    time += RETENTION_DAYS * DAY_MS;
    expect((await store.load({ scope, now: time })).records).toHaveLength(0);
  });

  test("learn false, stale or malformed operations never create feedback", async () => {
    const store = createMemoryRankingStore({ now: () => now });
    await store.commit(feedback({ learn: false }));
    await store.commit(feedback({ occurredAt: Number.NaN }));
    await store.commit(feedback({ occurredAt: now - RETENTION_DAYS * DAY_MS }));
    await store.commit(feedback({ occurredAt: now + FUTURE_SKEW_MS + 1 }));
    expect((await store.load({ scope, now })).records).toHaveLength(0);
  });

  test("throwing observers cannot turn committed feedback into a failed write", async () => {
    const store = createMemoryRankingStore({ now: () => now });
    store.subscribe?.(() => {
      throw new Error("observer");
    });
    await expect(store.commit(feedback())).resolves.toBeUndefined();
    expect((await store.load({ scope, now })).records).toHaveLength(2);
  });
});
