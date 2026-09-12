import { afterEach, describe, expect, test } from "bun:test";
import type {
  CmdFlow,
  CommandDefinition,
  FeedbackCommit,
  RankingInvalidation,
  RankingQueryPolicy,
  RankingScope,
} from "@cmdflow/core";
import {
  createCmdFlow,
  createRankingSurfaceId,
  DAY_MS,
  deriveRankingQueryKey,
  RETENTION_DAYS,
  recordSuccessfulUseV1,
} from "@cmdflow/core";
import { IDBFactory } from "fake-indexeddb";
import {
  createIndexedDBRankingStore,
  type IndexedDBRankingOptions,
  type IndexedDBRankingStore,
} from "../src/persistence.js";

const now = 20_000 * DAY_MS;
const scope: RankingScope = {
  subjectKey: "opaque-user",
  surfaceId: "commands",
  contextKey: "opaque-project",
};
const stores = new Set<IndexedDBRankingStore>();
const flows = new Set<{ destroy(): void }>();
const connections = new Set<IDBDatabase>();

afterEach(() => {
  for (const flow of flows) flow.destroy();
  flows.clear();
  for (const store of stores) store.destroy();
  stores.clear();
  for (const database of connections) database.close();
  connections.clear();
});

function waitForFlow(flow: Pick<CmdFlow, "subscribe">, predicate: () => boolean): Promise<void> {
  if (predicate()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("Expected flow state was not reached."));
    }, 1_000);
    const unsubscribe = flow.subscribe(() => {
      if (!predicate()) return;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });
}

function feedbackFinished(flow: Pick<CmdFlow, "onEvent">): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("Ranking feedback did not commit."));
    }, 1_000);
    const unsubscribe = flow.onEvent((event) => {
      if (event.type !== "ranking-feedback") return;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });
}

function githubCommands(): CommandDefinition<Record<string, never>>[] {
  return Array.from({ length: 10 }, (_, at) => ({
    id: `github-${at}`,
    title: `GitHub result ${at}`,
    run: () => ({ type: "stay" }),
    actions: [{ id: "copy", title: "Copy link", run: () => ({ type: "stay" }) }],
  }));
}

function makeStore(
  factory: IDBFactory | null,
  options: IndexedDBRankingOptions = {},
): IndexedDBRankingStore {
  const store = createIndexedDBRankingStore({
    indexedDB: factory,
    now: () => now,
    databaseName: "test-ranking",
    crypto: globalThis.crypto,
    createChannel: () => ({ postMessage() {}, close() {} }),
    ...options,
  });
  stores.add(store);
  return store;
}

function commit(overrides: Partial<FeedbackCommit> = {}): FeedbackCommit {
  return {
    operationId: "operation-1",
    candidateId: "source:chosen",
    scope,
    occurredAt: now,
    ...overrides,
  };
}

async function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open("test-ranking", 1);
    request.onsuccess = () => {
      connections.add(request.result);
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

async function readStore<T>(database: IDBDatabase, name: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction([name], "readonly");
    const request = tx.objectStore(name).getAll();
    tx.oncomplete = () => resolve(request.result as T[]);
    tx.onabort = () => reject(tx.error);
  });
}

async function change(
  database: IDBDatabase,
  names: string[],
  run: (tx: IDBTransaction) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(names, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    run(tx);
  });
}

describe("IndexedDB ranking persistence", () => {
  test("successful feedback survives reopening, uses non-extractable HMAC, and stores no raw query", async () => {
    const factory = new IDBFactory();
    const first = makeStore(factory);
    await first.ready;
    const firstPolicy = await first.getQueryPolicy(scope);
    expect(firstPolicy.strategy).toBe("fingerprint");
    const firstKey = await deriveRankingQueryKey("GitHub private-project", scope, firstPolicy);
    await first.commit(commit({ queryKey: firstKey }));
    const initial = await first.load({ scope, now });
    expect(initial.records).toHaveLength(4);
    first.destroy();

    const second = makeStore(factory);
    const secondPolicy = await second.getQueryPolicy(scope);
    expect(await deriveRankingQueryKey("GitHub private-project", scope, secondPolicy)).toEqual(
      firstKey,
    );
    const restored = await second.load({ scope, now });
    expect(restored.records).toEqual(initial.records);
    expect(Object.isFrozen(restored.records[0]?.scope)).toBe(true);
    const database = await openDatabase(factory);
    const records = await readStore(database, "records");
    expect(JSON.stringify(records)).not.toContain("private-project");
    expect(JSON.stringify(records)).not.toContain("github");
    const metadata = await readStore<{ key: CryptoKey; fingerprintKeyId: string }>(
      database,
      "profiles",
    );
    expect(metadata[0]?.key.extractable).toBe(false);
    await expect(
      globalThis.crypto.subtle.exportKey("raw", metadata[0]?.key as CryptoKey),
    ).rejects.toThrow();
  });

  test("concurrent tabs update all aggregates without lost updates or duplicate operation replay", async () => {
    const factory = new IDBFactory();
    const first = makeStore(factory, { queryRetention: "plain" });
    const second = makeStore(factory, { queryRetention: "plain" });
    await Promise.all([first.ready, second.ready]);
    const queryKey = await deriveRankingQueryKey("github", scope, { strategy: "plain" });
    await Promise.all(
      Array.from({ length: 10 }, (_, at) =>
        (at % 2 === 0 ? first : second).commit(
          commit({ queryKey, operationId: `operation-${at}` }),
        ),
      ),
    );
    await Promise.all([first.commit(commit({ queryKey })), second.commit(commit({ queryKey }))]);
    let expected = 0;
    for (let at = 0; at < 10; at += 1) expected = recordSuccessfulUseV1(expected, 0);
    const result = await first.load({ scope, now });
    expect(result.records).toHaveLength(4);
    expect(result.records.every((record) => record.value === expected)).toBe(true);
  });

  test("concurrent fingerprint initialization chooses one persisted key per profile", async () => {
    const factory = new IDBFactory();
    const a = makeStore(factory);
    const b = makeStore(factory);
    const [aPolicy, bPolicy] = await Promise.all([
      a.getQueryPolicy(scope),
      b.getQueryPolicy(scope),
    ]);
    expect(await deriveRankingQueryKey("github", scope, aPolicy)).toEqual(
      await deriveRankingQueryKey("github", scope, bPolicy),
    );
    const otherScope = { ...scope, subjectKey: "different-user" };
    const otherPolicy = await a.getQueryPolicy(otherScope);
    expect(await deriveRankingQueryKey("github", otherScope, otherPolicy)).not.toEqual(
      await deriveRankingQueryKey("github", scope, aPolicy),
    );
  });

  test("missing fingerprint keys delete orphaned query history before creating a replacement", async () => {
    const factory = new IDBFactory();
    const first = makeStore(factory);
    const oldKey = await deriveRankingQueryKey("github", scope, await first.getQueryPolicy(scope));
    await first.commit(commit({ queryKey: oldKey }));
    const database = await openDatabase(factory);
    await change(database, ["profiles"], (tx) => {
      const profiles = tx.objectStore("profiles");
      const request = profiles.get(scope.subjectKey);
      request.onsuccess = () => {
        const data = request.result;
        delete data.key;
        profiles.put(data);
      };
    });
    first.destroy();
    const second = makeStore(factory);
    const newKey = await deriveRankingQueryKey("github", scope, await second.getQueryPolicy(scope));
    expect(newKey).not.toEqual(oldKey);
    expect((await second.load({ scope, now })).records.map((record) => record.kind).sort()).toEqual(
      ["item-context", "item-surface"],
    );
    expect(JSON.stringify(await readStore(database, "records"))).not.toContain(
      oldKey?.value ?? "missing",
    );
  });

  test("reset removes the requested history atomically and replay cannot resurrect it", async () => {
    const factory = new IDBFactory();
    const store = makeStore(factory, { queryRetention: "plain" });
    const queryKey = await deriveRankingQueryKey("github", scope, { strategy: "plain" });
    await store.commit(commit({ queryKey }));
    await store.reset({
      type: "query",
      subjectKey: scope.subjectKey,
      queryKey: queryKey as NonNullable<typeof queryKey>,
    });
    expect((await store.load({ scope, now })).records).toHaveLength(2);
    await store.commit(commit({ queryKey }));
    expect((await store.load({ scope, now })).records).toHaveLength(2);
    await store.reset({ type: "item", subjectKey: scope.subjectKey, candidateId: "source:chosen" });
    expect((await store.load({ scope, now })).records).toHaveLength(0);
  });

  test("global reset clears every namespace and rotates keys without storing query payloads", async () => {
    const factory = new IDBFactory();
    const store = makeStore(factory);
    const oldKey = await deriveRankingQueryKey("github", scope, await store.getQueryPolicy(scope));
    await store.commit(commit({ queryKey: oldKey }));
    const otherScope = { ...scope, subjectKey: "other" };
    await store.commit(commit({ scope: otherScope }));
    await store.reset({ type: "all" });
    expect((await store.load({ scope, now })).records).toHaveLength(0);
    expect((await store.load({ scope: otherScope, now })).records).toHaveLength(0);
    const newKey = await deriveRankingQueryKey("github", scope, await store.getQueryPolicy(scope));
    expect(newKey).not.toEqual(oldKey);
    await store.commit(commit({ queryKey: newKey }));
    expect((await store.load({ scope, now })).records).toHaveLength(0);
  });

  test("privacy TTL and deterministic per-subject quotas apply on storage reads", async () => {
    const factory = new IDBFactory();
    const store = makeStore(factory, { queryRetention: "none", maxRecords: 2 });
    const surface = { subjectKey: scope.subjectKey, surfaceId: scope.surfaceId };
    for (const candidateId of ["b", "c", "a"])
      await store.commit(commit({ scope: surface, candidateId, operationId: candidateId }));
    expect((await store.load({ scope, now })).records.map((record) => record.candidateId)).toEqual([
      "b",
      "c",
    ]);
    expect((await store.load({ scope, now: now + RETENTION_DAYS * DAY_MS })).records).toHaveLength(
      0,
    );
    const database = await openDatabase(factory);
    expect(await readStore(database, "records")).toHaveLength(0);
    expect(await readStore(database, "operations")).toHaveLength(0);
  });

  test("corrupt scores and incompatible versions are removed without breaking search", async () => {
    const factory = new IDBFactory();
    const store = makeStore(factory, { queryRetention: "none" });
    await store.commit(commit());
    const database = await openDatabase(factory);
    await change(database, ["records"], (tx) => {
      const records = tx.objectStore("records");
      const request = records.getAll();
      request.onsuccess = () => {
        for (const [at, entry] of request.result.entries()) {
          if (at === 0) entry.record.value = Number.NaN;
          else entry.record.version = 999;
          records.put(entry);
        }
      };
    });
    expect((await store.load({ scope, now })).records).toHaveLength(0);
    await store.commit(commit({ operationId: "new" }));
    expect((await store.load({ scope, now })).records).toHaveLength(2);
  });

  test("a failure midway through writing aggregates aborts the entire transaction and falls back", async () => {
    const factory = new IDBFactory();
    const originalOpen = factory.open.bind(factory);
    let injectFailure = false;
    factory.open = (name, version) => {
      const request = originalOpen(name, version);
      request.addEventListener("success", () => {
        const database = request.result;
        const originalTransaction = database.transaction.bind(database);
        database.transaction = (names, mode, options) => {
          const transaction = originalTransaction(names, mode, options);
          if (injectFailure && mode === "readwrite") {
            const originalObjectStore = transaction.objectStore.bind(transaction);
            transaction.objectStore = (name) => {
              const objectStore = originalObjectStore(name);
              if (name === "records") {
                const originalPut = objectStore.put.bind(objectStore);
                objectStore.put = (value, key) => {
                  originalPut(value, key);
                  transaction.abort();
                  throw new DOMException("Injected quota failure", "QuotaExceededError");
                };
              }
              return objectStore;
            };
          }
          return transaction;
        };
      });
      return request;
    };
    const events: string[] = [];
    const store = makeStore(factory, {
      queryRetention: "plain",
      onDiagnostic: ({ code }) => events.push(code),
    });
    await store.ready;
    injectFailure = true;
    await store.commit(commit({ queryKey: { strategy: "plain", value: "github" } }));
    injectFailure = false;
    const database = await openDatabase(factory);
    expect(await readStore(database, "records")).toHaveLength(0);
    expect(await readStore(database, "operations")).toHaveLength(0);
    expect((await store.load({ scope, now })).records).toHaveLength(4);
    expect(events).toContain("storage-fallback");
    await store.commit(commit({ queryKey: { strategy: "plain", value: "github" } }));
    expect(
      (await store.load({ scope, now })).records.every((record) => record.value === 1_000),
    ).toBe(true);
  });

  test("broadcasts contain only opaque invalidation and arrive after the entire transaction commits", async () => {
    const factory = new IDBFactory();
    const peers = new Set<(message: unknown) => void>();
    const broadcasts: RankingInvalidation[] = [];
    const createChannel: NonNullable<IndexedDBRankingOptions["createChannel"]> = (
      _name,
      receive,
    ) => {
      peers.add(receive);
      return {
        postMessage(message) {
          broadcasts.push(message);
          for (const peer of peers) if (peer !== receive) peer(message);
        },
        close() {
          peers.delete(receive);
        },
      };
    };
    const a = makeStore(factory, { queryRetention: "plain", createChannel });
    const b = makeStore(factory, { queryRetention: "plain", createChannel });
    await Promise.all([a.ready, b.ready]);
    const observed: Promise<number>[] = [];
    b.subscribe?.(() => {
      observed.push(b.load({ scope, now }).then((profile) => profile.records.length));
    });
    await a.commit(commit({ queryKey: { strategy: "plain", value: "private github query" } }));
    expect(await Promise.all(observed)).toEqual([4]);
    expect(broadcasts).toHaveLength(1);
    expect(Object.keys(broadcasts[0] ?? {}).sort()).toEqual(["namespace", "revision"]);
    expect(JSON.stringify(broadcasts)).not.toContain("github");
  });

  test("none retention rejects query history and missing cryptography still supports item history", async () => {
    const factory = new IDBFactory();
    const store = makeStore(factory, { crypto: null });
    expect(await store.getQueryPolicy(scope)).toEqual({ strategy: "none" });
    await store.commit(commit({ queryKey: { strategy: "plain", value: "secret" } }));
    expect((await store.load({ scope, now })).records).toHaveLength(2);
  });

  test("IndexedDB denial and open timeout resolve ready and fall back to memory", async () => {
    const diagnostics: string[] = [];
    const denied = makeStore(null, {
      onDiagnostic: (event) => diagnostics.push(event.code),
      queryRetention: "plain",
    });
    await denied.ready;
    await denied.commit(commit({ queryKey: { strategy: "plain", value: "github" } }));
    expect((await denied.load({ scope, now })).records).toHaveLength(4);
    expect(diagnostics).toContain("storage-fallback");

    const hanging = { open: () => ({}) } as unknown as IDBFactory;
    const timed = makeStore(hanging, { timeoutMs: 10 });
    await timed.ready;
    await timed.commit(commit());
    expect((await timed.load({ scope, now })).records).toHaveLength(2);
  });

  test("versionchange closes the connection and subsequent work uses memory", async () => {
    const factory = new IDBFactory();
    const store = makeStore(factory, { queryRetention: "none" });
    await store.commit(commit());
    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open("test-ranking", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    connections.add(upgraded);
    await store.commit(commit({ operationId: "after-upgrade" }));
    expect(
      (await store.load({ scope, now })).records.every((record) => record.value === 1_900),
    ).toBe(true);
  });

  test("destroy closes resources and rejects subsequent access", async () => {
    const factory = new IDBFactory();
    let closed = false;
    const store = makeStore(factory, {
      createChannel: () => ({
        postMessage() {},
        close() {
          closed = true;
        },
      }),
    });
    await store.ready;
    store.destroy();
    store.destroy();
    expect(closed).toBe(true);
    await expect(store.load({ scope, now })).rejects.toThrow("destroyed");
    await expect(store.getQueryPolicy(scope)).rejects.toThrow("destroyed");
  });
});

describe("CmdFlow and persistent ranking integration", () => {
  test("the sixth GitHub result becomes first in a new flow using persisted fingerprint feedback", async () => {
    const factory = new IDBFactory();
    const storage = makeStore(factory);
    const first = createCmdFlow({
      id: "same-panel-id",
      clock: { now: () => now },
      commands: githubCommands(),
      ranking: { scope, store: storage, queryPolicy: storage.getQueryPolicy },
    });
    flows.add(first);
    first.open();
    first.setQuery("github");
    await waitForFlow(first, () => first.getSnapshot().rankingReady);
    expect(first.getSnapshot().current.items).toHaveLength(10);
    const sixth = first.getSnapshot().current.items[5];
    expect(sixth?.id).toBe("github-5");
    if (!sixth) throw new Error("Missing sixth result.");
    first.setActive(sixth.candidateId);
    const learned = feedbackFinished(first);
    expect((await first.invoke()).status).toBe("success");
    await learned;
    first.destroy();
    storage.destroy();

    const restoredStorage = makeStore(factory);
    const second = createCmdFlow({
      id: "same-panel-id",
      clock: { now: () => now },
      commands: githubCommands(),
      ranking: { scope, store: restoredStorage, queryPolicy: restoredStorage.getQueryPolicy },
    });
    flows.add(second);
    second.open();
    second.setQuery("github");
    await waitForFlow(
      second,
      () =>
        second.getSnapshot().rankingReady &&
        second.explainRanking()[0]?.exactContextAffinityFixed === 1_000,
    );
    expect(second.getSnapshot().current.items[0]?.candidateId).toBe(sixth.candidateId);
    second.setActive(sixth.candidateId);
    const secondLearned = feedbackFinished(second);
    await second.invoke();
    await secondLearned;
    const profile = await restoredStorage.load({
      scope: { ...scope, surfaceId: createRankingSurfaceId("commands", "main", "root") },
      now,
    });
    expect(profile.records).toHaveLength(4);
    expect(profile.records.every((record) => record.value === 1_900)).toBe(true);
  });

  test("a filtered contextual action learns its originating result and query", async () => {
    const factory = new IDBFactory();
    const storage = makeStore(factory);
    const flow = createCmdFlow({
      clock: { now: () => now },
      commands: githubCommands(),
      ranking: { scope, store: storage, queryPolicy: storage.getQueryPolicy },
    });
    flows.add(flow);
    flow.open();
    flow.setQuery("github");
    await waitForFlow(flow, () => flow.getSnapshot().rankingReady);
    const selected = flow.getSnapshot().current.items[5];
    if (!selected) throw new Error("Missing selected result.");
    flow.setActive(selected.candidateId);
    flow.openActions();
    const actionFrame = flow.getSnapshot().actionFrame;
    if (!actionFrame) throw new Error("Missing action panel.");
    const address = { surface: "actions" as const, frameId: actionFrame.id };
    flow.setQuery("copy", address);
    expect(flow.getSnapshot().actionFrame?.items).toHaveLength(1);
    const learned = feedbackFinished(flow);
    expect((await flow.invoke({ address })).status).toBe("success");
    await learned;
    const originScope = { ...scope, surfaceId: createRankingSurfaceId("commands", "main", "root") };
    const profile = await storage.load({ scope: originScope, now });
    const policy = await storage.getQueryPolicy(originScope);
    const originKey = await deriveRankingQueryKey("github", originScope, policy);
    const actionKey = await deriveRankingQueryKey("copy", originScope, policy);
    expect(profile.records).toHaveLength(4);
    expect(profile.records.every((record) => record.candidateId === selected.candidateId)).toBe(
      true,
    );
    const queryRecords = profile.records.filter((record) => record.queryKey);
    expect(queryRecords).toHaveLength(2);
    expect(queryRecords.every((record) => record.queryKey?.value === originKey?.value)).toBe(true);
    expect(queryRecords.some((record) => record.queryKey?.value === actionKey?.value)).toBe(false);
    expect(
      (await storage.load({ scope: { ...scope, surfaceId: "commands:actions:root:actions" }, now }))
        .records,
    ).toHaveLength(0);
  });

  test("reset fences success feedback waiting for a fingerprint so delayed work cannot relearn history", async () => {
    const factory = new IDBFactory();
    const storage = makeStore(factory);
    const actualPolicy = await storage.getQueryPolicy(scope);
    if (actualPolicy.strategy !== "fingerprint") throw new Error("Fingerprint policy required.");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const signatures: Promise<string>[] = [];
    const delayedPolicy: RankingQueryPolicy = {
      ...actualPolicy,
      fingerprint(input) {
        const pending = gate.then(() => actualPolicy.fingerprint(input));
        signatures.push(pending);
        return pending;
      },
    };
    let commits = 0;
    const flow = createCmdFlow({
      clock: { now: () => now },
      commands: githubCommands(),
      ranking: {
        scope,
        queryPolicy: async () => delayedPolicy,
        store: {
          load: storage.load,
          reset: storage.reset,
          subscribe: storage.subscribe,
          async commit(feedback) {
            commits += 1;
            await storage.commit(feedback);
          },
        },
      },
    });
    flows.add(flow);
    flow.open();
    flow.setQuery("github");
    await waitForFlow(flow, () => flow.getSnapshot().rankingReady);
    const selected = flow.getSnapshot().current.items[5];
    if (!selected) throw new Error("Missing selected result.");
    flow.setActive(selected.candidateId);
    await flow.invoke();
    expect(signatures.length).toBeGreaterThan(0);
    await flow.resetRanking();
    release();
    await Promise.all(signatures);
    for (let at = 0; at < 10; at += 1) await Promise.resolve();
    expect(commits).toBe(0);
    const profile = await storage.load({
      scope: { ...scope, surfaceId: createRankingSurfaceId("commands", "main", "root") },
      now,
    });
    expect(profile.records).toHaveLength(0);
  });
});
