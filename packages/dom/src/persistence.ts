import type {
  FeedbackCommit,
  RankingInvalidation,
  RankingInvalidationListener,
  RankingLoadRequest,
  RankingProfile,
  RankingQueryPolicy,
  RankingRecord,
  RankingResetSelector,
  RankingScope,
  RankingStore,
} from "@cmdflow/core";
import {
  createMemoryRankingStore,
  DAY_MS,
  FUTURE_SKEW_MS,
  matchesRankingReset,
  RETENTION_DAYS,
  rankingRecordKeyV1,
  recordSuccessfulUseV1,
  sanitizeRankingRecord,
} from "@cmdflow/core";

export interface RankingChannel {
  postMessage(message: RankingInvalidation): void;
  close(): void;
}

export interface IndexedDBRankingOptions {
  databaseName?: string;
  indexedDB?: IDBFactory | null;
  crypto?: Crypto | null;
  now?: () => number;
  queryRetention?: "none" | "fingerprint" | "plain";
  maxRecords?: number;
  /** Bounds opening and individual transactions. Defaults to 1,500ms. */
  timeoutMs?: number;
  createChannel?: (name: string, receive: (message: unknown) => void) => RankingChannel;
  onDiagnostic?: (event: { code: string; error?: unknown }) => void;
}

export interface IndexedDBRankingStore extends RankingStore {
  readonly ready: Promise<void>;
  getQueryPolicy(scope: RankingScope): Promise<RankingQueryPolicy>;
  destroy(): void;
}

interface StoredRecord {
  key: string;
  namespace: string;
  record: RankingRecord;
}

interface StoredOperation {
  key: string;
  namespace: string;
  occurredAt: number;
}

interface StoredProfile {
  namespace: string;
  version: 1;
  revision: number;
  fingerprintKeyId?: string;
  key?: CryptoKey;
}

interface NamespaceState {
  records: Map<string, RankingRecord>;
  operations: Map<string, StoredOperation>;
  profile: StoredProfile;
  changed: boolean;
}

const STORES = ["records", "operations", "profiles"];

function codeUnitOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isHmacKey(key: CryptoKey | undefined): key is CryptoKey {
  const algorithm = key?.algorithm as HmacKeyAlgorithm | undefined;
  return (
    key?.type === "secret" &&
    key.extractable === false &&
    algorithm?.name === "HMAC" &&
    algorithm.hash?.name === "SHA-256" &&
    Array.isArray(key.usages) &&
    key.usages.includes("sign")
  );
}

function validNamespace(scope: RankingScope): void {
  if (typeof scope?.subjectKey !== "string" || typeof scope.surfaceId !== "string") {
    throw new TypeError("A ranking subject and surface are required.");
  }
}

function frozenProfile(state: NamespaceState, scope: RankingScope): RankingProfile {
  const records = Array.from(state.records.values())
    .filter(
      (record) =>
        record.scope.surfaceId === scope.surfaceId &&
        (record.scope.contextKey === undefined || record.scope.contextKey === scope.contextKey),
    )
    .sort((a, b) => codeUnitOrder(rankingRecordKeyV1(a), rankingRecordKeyV1(b)))
    .map((record) =>
      Object.freeze({
        ...record,
        scope: Object.freeze({ ...record.scope }),
        queryKey: record.queryKey ? Object.freeze({ ...record.queryKey }) : undefined,
      }),
    );
  return Object.freeze({
    version: 1,
    revision: state.profile.revision,
    records: Object.freeze(records),
  });
}

/** Optional browser persistence. Importing this module never accesses browser globals. */
export function createIndexedDBRankingStore(
  options: IndexedDBRankingOptions = {},
): IndexedDBRankingStore {
  const databaseName = options.databaseName ?? "cmdflow-ranking-v1";
  const factory = options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB;
  const crypto = options.crypto === undefined ? globalThis.crypto : options.crypto;
  const clock = options.now ?? Date.now;
  const retention = options.queryRetention ?? "fingerprint";
  const timeoutMs = Math.max(1, options.timeoutMs ?? 1_500);
  const quota = Number.isSafeInteger(options.maxRecords)
    ? Math.max(1, options.maxRecords ?? 5_000)
    : 5_000;
  const memory = createMemoryRankingStore({
    now: clock,
    maxRecords: quota,
    allowPlainQueryKeys: retention === "plain",
  });
  const listeners = new Set<RankingInvalidationListener>();
  const policies = new Map<string, Promise<RankingQueryPolicy>>();
  const pendingTransactions = new Set<IDBTransaction>();
  let database: IDBDatabase | undefined;
  let fallback = false;
  let disposed = false;
  let channel: RankingChannel | undefined;

  function diagnostic(code: string, error?: unknown): void {
    try {
      options.onDiagnostic?.({ code, error });
    } catch {
      /* Diagnostics are observational. */
    }
  }

  function notify(invalidation: RankingInvalidation, broadcast: boolean): void {
    for (const listener of listeners) {
      try {
        listener(invalidation);
      } catch {
        /* A subscriber cannot reject a committed write. */
      }
    }
    if (broadcast) {
      try {
        channel?.postMessage(invalidation);
      } catch (error) {
        diagnostic("broadcast-failed", error);
      }
    }
  }

  function receive(message: unknown): void {
    if (disposed || typeof message !== "object" || message === null) return;
    const value = message as Partial<RankingInvalidation>;
    if (
      typeof value.namespace !== "string" ||
      !Number.isSafeInteger(value.revision) ||
      (value.revision ?? -1) < 0
    )
      return;
    policies.delete(value.namespace);
    notify({ namespace: value.namespace, revision: value.revision as number }, false);
  }

  try {
    if (options.createChannel) channel = options.createChannel(databaseName, receive);
    else if (typeof globalThis.BroadcastChannel === "function") {
      const broadcast = new globalThis.BroadcastChannel(databaseName);
      broadcast.addEventListener("message", (event: MessageEvent<unknown>) => receive(event.data));
      channel = {
        postMessage: (message) => broadcast.postMessage(message),
        close: () => broadcast.close(),
      };
    }
  } catch (error) {
    diagnostic("broadcast-unavailable", error);
  }

  const unsubscribeMemory = memory.subscribe?.((event) => {
    if (fallback) notify(event, false);
  });

  function fail(error: unknown): void {
    if (!fallback) diagnostic("storage-fallback", error);
    fallback = true;
    database?.close();
    database = undefined;
    policies.clear();
  }

  const ready = new Promise<void>((resolve) => {
    if (!factory) {
      fail(new Error("IndexedDB is unavailable."));
      resolve();
      return;
    }
    let completed = false;
    const finish = (error?: unknown) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      if (error) fail(error);
      resolve();
    };
    const timer = setTimeout(() => finish(new Error("IndexedDB open timed out.")), timeoutMs);
    try {
      const request = factory.open(databaseName, 1);
      request.onupgradeneeded = () => {
        if (completed || disposed) {
          request.transaction?.abort();
          return;
        }
        const db = request.result;
        for (const name of ["records", "operations"]) {
          if (!db.objectStoreNames.contains(name))
            db.createObjectStore(name, { keyPath: "key" }).createIndex("namespace", "namespace");
        }
        if (!db.objectStoreNames.contains("profiles"))
          db.createObjectStore("profiles", { keyPath: "namespace" });
      };
      request.onblocked = () => finish(new Error("IndexedDB upgrade is blocked."));
      request.onerror = () => finish(request.error ?? new Error("IndexedDB open failed."));
      request.onsuccess = () => {
        if (completed || disposed) {
          request.result.close();
          finish();
          return;
        }
        database = request.result;
        database.onversionchange = () => {
          fail(new Error("IndexedDB schema changed in another connection."));
        };
        database.onclose = () => {
          if (!disposed) fail(new Error("IndexedDB connection closed."));
        };
        finish();
      };
    } catch (error) {
      finish(error);
    }
  });

  function transaction<T>(
    stores: string[],
    mode: IDBTransactionMode,
    run: (tx: IDBTransaction, result: (value: T) => void, fail: (error: unknown) => void) => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!database || disposed) {
        reject(new Error("Ranking storage is unavailable."));
        return;
      }
      let tx: IDBTransaction;
      try {
        tx = database.transaction(stores, mode);
      } catch (error) {
        reject(error);
        return;
      }
      pendingTransactions.add(tx);
      let result: T;
      let hasResult = false;
      const timer = setTimeout(() => {
        try {
          tx.abort();
        } catch {
          /* May already be completed. */
        }
        reject(new Error("IndexedDB transaction timed out."));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        pendingTransactions.delete(tx);
      };
      tx.oncomplete = () => {
        cleanup();
        if (hasResult) resolve(result);
        else reject(new Error("Missing transaction result."));
      };
      tx.onabort = () => {
        cleanup();
        reject(tx.error ?? new Error("IndexedDB transaction aborted."));
      };
      tx.onerror = () => {
        /* The transaction's abort event owns rejection. */
      };
      const rejectTransaction = (error: unknown) => {
        cleanup();
        try {
          tx.abort();
        } catch {
          /* Already inactive. */
        }
        reject(error);
      };
      try {
        run(
          tx,
          (value) => {
            result = value;
            hasResult = true;
          },
          rejectTransaction,
        );
      } catch (error) {
        rejectTransaction(error);
      }
    });
  }

  async function withNamespace<T>(
    namespace: string,
    now: number,
    run: (state: NamespaceState) => T,
  ): Promise<{ value: T; state: NamespaceState }> {
    if (!Number.isSafeInteger(now))
      throw new TypeError("Ranking time must be a finite safe integer.");
    const result = await transaction<{ value: T; state: NamespaceState }>(
      STORES,
      "readwrite",
      (tx, complete, failTransaction) => {
        const recordStore = tx.objectStore("records");
        const operationStore = tx.objectStore("operations");
        const profileStore = tx.objectStore("profiles");
        const recordRequest = recordStore.index("namespace").getAll(namespace);
        const operationRequest = operationStore.index("namespace").getAll(namespace);
        const profileRequest = profileStore.get(namespace);
        let pending = 3;
        const received = () => {
          pending -= 1;
          if (pending !== 0) return;
          const previous = profileRequest.result as StoredProfile | undefined;
          const validProfile =
            previous?.version === 1 &&
            Number.isSafeInteger(previous.revision) &&
            previous.revision >= 0;
          const state: NamespaceState = {
            records: new Map(),
            operations: new Map(),
            profile: validProfile ? { ...previous } : { namespace, version: 1, revision: 0 },
            changed: previous !== undefined && !validProfile,
          };
          const beforeRecords = recordRequest.result as StoredRecord[];
          const beforeOperations = operationRequest.result as StoredOperation[];
          for (const envelope of beforeRecords) {
            const record = sanitizeRankingRecord(envelope.record, now);
            const key = record?.queryKey;
            const permitted =
              !key ||
              (retention === "plain" && key.strategy === "plain") ||
              (retention === "fingerprint" &&
                key.strategy === "fingerprint" &&
                key.fingerprintKeyId === state.profile.fingerprintKeyId &&
                isHmacKey(state.profile.key));
            if (
              !record ||
              record.scope.subjectKey !== namespace ||
              record.value < 100 ||
              !permitted
            ) {
              state.changed = true;
              continue;
            }
            const canonical = rankingRecordKeyV1(record);
            if (
              canonical !== envelope.key ||
              record.value !== envelope.record.value ||
              record.lastUsedAt !== envelope.record.lastUsedAt ||
              record.decayedThroughDay !== envelope.record.decayedThroughDay
            )
              state.changed = true;
            state.records.set(canonical, record);
          }
          for (const operation of beforeOperations) {
            if (
              !Number.isSafeInteger(operation.occurredAt) ||
              now - operation.occurredAt >= RETENTION_DAYS * DAY_MS ||
              operation.occurredAt > now + FUTURE_SKEW_MS
            ) {
              state.changed = true;
              continue;
            }
            state.operations.set(operation.key, operation);
          }
          let value: T;
          try {
            value = run(state);
          } catch (error) {
            tx.abort();
            throw error;
          }
          if (state.records.size > quota) {
            const ordered = Array.from(state.records.values()).sort(
              (a, b) =>
                a.value - b.value ||
                a.lastUsedAt - b.lastUsedAt ||
                codeUnitOrder(rankingRecordKeyV1(a), rankingRecordKeyV1(b)),
            );
            for (const record of ordered.slice(0, ordered.length - quota))
              state.records.delete(rankingRecordKeyV1(record));
            state.changed = true;
          }
          if (state.changed) {
            state.profile.revision += 1;
            for (const record of beforeRecords)
              if (!state.records.has(record.key)) recordStore.delete(record.key);
            for (const [key, record] of state.records)
              recordStore.put({ key, namespace, record } satisfies StoredRecord);
            for (const operation of beforeOperations)
              if (!state.operations.has(operation.key)) operationStore.delete(operation.key);
            for (const operation of state.operations.values()) operationStore.put(operation);
            profileStore.put(state.profile);
          }
          complete({ value, state });
        };
        const receivedSafely = () => {
          try {
            received();
          } catch (error) {
            failTransaction(error);
          }
        };
        recordRequest.onsuccess = receivedSafely;
        operationRequest.onsuccess = receivedSafely;
        profileRequest.onsuccess = receivedSafely;
      },
    );
    if (result.state.changed) notify({ namespace, revision: result.state.profile.revision }, true);
    return result;
  }

  async function available(): Promise<boolean> {
    if (disposed) throw new Error("Ranking storage has been destroyed.");
    await ready;
    if (disposed) throw new Error("Ranking storage has been destroyed.");
    return !fallback && database !== undefined;
  }

  async function policyFor(scope: RankingScope): Promise<RankingQueryPolicy> {
    if (retention === "none" || retention === "plain") return { strategy: retention };
    if (!crypto?.subtle) {
      diagnostic("fingerprint-unavailable");
      return { strategy: "none" };
    }
    const persistent = await available();
    let existing: StoredProfile | undefined;
    if (persistent) {
      try {
        existing = (
          await withNamespace(scope.subjectKey, clock(), (state) => ({ ...state.profile }))
        ).value;
      } catch (error) {
        fail(error);
      }
    }
    let key = existing?.key;
    let fingerprintKeyId = existing?.fingerprintKeyId;
    let usable =
      isHmacKey(key) && typeof fingerprintKeyId === "string" && fingerprintKeyId.length > 0;
    if (usable) {
      try {
        await crypto.subtle.sign("HMAC", key as CryptoKey, new Uint8Array());
      } catch {
        usable = false;
      }
    }
    if (!usable) {
      try {
        key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        fingerprintKeyId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
      } catch (error) {
        diagnostic("fingerprint-unavailable", error);
        return { strategy: "none" };
      }
      if (!fallback && database) {
        const generatedKey = key;
        const generatedId = fingerprintKeyId;
        try {
          const saved = await withNamespace(scope.subjectKey, clock(), (state) => {
            // A competing tab may have created a valid key while cryptography was pending.
            if (
              state.profile.fingerprintKeyId !== existing?.fingerprintKeyId &&
              isHmacKey(state.profile.key) &&
              state.profile.fingerprintKeyId
            )
              return { ...state.profile };
            state.profile.key = generatedKey;
            state.profile.fingerprintKeyId = generatedId;
            for (const [id, record] of state.records) if (record.queryKey) state.records.delete(id);
            state.changed = true;
            return { ...state.profile };
          });
          key = saved.value.key;
          fingerprintKeyId = saved.value.fingerprintKeyId;
        } catch (error) {
          fail(error);
        }
      }
    }
    const signingKey = key;
    if (!signingKey || !fingerprintKeyId) return { strategy: "none" };
    return {
      strategy: "fingerprint",
      fingerprintKeyId,
      fingerprint: async (input) => {
        const signature = await crypto.subtle.sign(
          "HMAC",
          signingKey,
          new TextEncoder().encode(input),
        );
        return Array.from(new Uint8Array(signature), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
      },
    };
  }

  return {
    ready,
    async load(request: RankingLoadRequest) {
      validNamespace(request.scope);
      if (!(await available())) return memory.load(request);
      try {
        const result = await withNamespace(request.scope.subjectKey, request.now, () => undefined);
        return frozenProfile(result.state, request.scope);
      } catch (error) {
        if (disposed) throw error;
        fail(error);
        return memory.load(request);
      }
    },
    async commit(commit: FeedbackCommit) {
      if (commit.learn === false) return;
      validNamespace(commit.scope);
      if (!(await available())) return memory.commit(commit);
      const now = clock();
      if (
        typeof commit.operationId !== "string" ||
        !commit.operationId ||
        typeof commit.candidateId !== "string"
      )
        throw new TypeError("Stable operation and candidate IDs are required.");
      if (
        !Number.isSafeInteger(commit.occurredAt) ||
        commit.occurredAt > now + FUTURE_SKEW_MS ||
        now - commit.occurredAt >= RETENTION_DAYS * DAY_MS
      )
        return;
      try {
        await withNamespace(commit.scope.subjectKey, now, (state) => {
          const operationKey = JSON.stringify([commit.scope.subjectKey, commit.operationId]);
          if (state.operations.has(operationKey)) return;
          const key = commit.queryKey;
          const allowKey =
            key &&
            ((retention === "plain" && key.strategy === "plain") ||
              (retention === "fingerprint" &&
                key.strategy === "fingerprint" &&
                key.fingerprintKeyId === state.profile.fingerprintKeyId));
          const scopes: RankingScope[] = [
            { subjectKey: commit.scope.subjectKey, surfaceId: commit.scope.surfaceId },
          ];
          if (commit.scope.contextKey !== undefined) scopes.push({ ...commit.scope });
          for (const scope of scopes) {
            for (const queryKey of allowKey ? [undefined, key] : [undefined]) {
              const context = scope.contextKey !== undefined;
              const base: RankingRecord = {
                version: 1,
                scope,
                candidateId: commit.candidateId,
                queryKey,
                kind: queryKey
                  ? context
                    ? "query-context"
                    : "query-surface"
                  : context
                    ? "item-context"
                    : "item-surface",
                value: 0,
                lastUsedAt: Math.min(now, commit.occurredAt),
                decayedThroughDay: Math.floor(now / DAY_MS),
              };
              const id = rankingRecordKeyV1(base);
              const previous = state.records.get(id);
              state.records.set(id, {
                ...base,
                value: recordSuccessfulUseV1(previous?.value ?? 0, 0),
                lastUsedAt: Math.max(previous?.lastUsedAt ?? base.lastUsedAt, base.lastUsedAt),
              });
            }
          }
          state.operations.set(operationKey, {
            key: operationKey,
            namespace: commit.scope.subjectKey,
            occurredAt: Math.min(now, commit.occurredAt),
          });
          state.changed = true;
        });
        // Retain this tab's recent activity if the browser subsequently denies storage.
        await memory.commit(commit);
      } catch (error) {
        if (disposed) throw error;
        fail(error);
        await memory.commit(commit);
      }
    },
    async reset(selector: RankingResetSelector) {
      if (!(await available())) {
        policies.clear();
        return memory.reset(selector);
      }
      try {
        if (selector.type === "all" && selector.subjectKey === undefined) {
          const invalidations = await transaction<RankingInvalidation[]>(
            STORES,
            "readwrite",
            (tx, result, abort) => {
              const profiles = tx.objectStore("profiles");
              const request = profiles.getAll();
              request.onsuccess = () => {
                try {
                  const updates: RankingInvalidation[] = [];
                  tx.objectStore("records").clear();
                  for (const raw of request.result as StoredProfile[]) {
                    if (typeof raw.namespace !== "string") continue;
                    const revision = Number.isSafeInteger(raw.revision)
                      ? Math.max(0, raw.revision) + 1
                      : 1;
                    profiles.put({
                      namespace: raw.namespace,
                      version: 1,
                      revision,
                    } satisfies StoredProfile);
                    updates.push({ namespace: raw.namespace, revision });
                  }
                  result(updates);
                } catch (error) {
                  abort(error);
                }
              };
            },
          );
          policies.clear();
          for (const event of invalidations) notify(event, true);
          await memory.reset(selector);
          return;
        }
        const namespaces = [selector.subjectKey as string];
        for (const namespace of namespaces) {
          await withNamespace(namespace, clock(), (state) => {
            for (const [key, record] of state.records)
              if (matchesRankingReset(record, selector)) {
                state.records.delete(key);
                state.changed = true;
              }
            if (
              selector.type === "all" ||
              (selector.type === "fingerprint" &&
                state.profile.fingerprintKeyId === selector.fingerprintKeyId)
            ) {
              delete state.profile.key;
              delete state.profile.fingerprintKeyId;
              state.changed = true;
            }
          });
          policies.delete(namespace);
        }
        await memory.reset(selector);
      } catch (error) {
        if (disposed) throw error;
        fail(error);
        await memory.reset(selector);
      }
    },
    getQueryPolicy(scope) {
      validNamespace(scope);
      if (disposed) return Promise.reject(new Error("Ranking storage has been destroyed."));
      const existing = policies.get(scope.subjectKey);
      if (existing) return existing;
      const pending = policyFor(scope).catch((error) => {
        diagnostic("fingerprint-unavailable", error);
        return { strategy: "none" } as const;
      });
      policies.set(scope.subjectKey, pending);
      return pending;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      for (const tx of pendingTransactions) {
        try {
          tx.abort();
        } catch {
          /* Already inactive. */
        }
      }
      database?.close();
      database = undefined;
      channel?.close();
      unsubscribeMemory?.();
      policies.clear();
      listeners.clear();
    },
  };
}
