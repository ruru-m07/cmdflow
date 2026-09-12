# Learned ranking persistence

CmdFlow learns from successful executions. Its default store is ephemeral memory; install the
optional browser adapter when preferences should survive a reload. The core package remains free
of browser storage dependencies.

```ts
import { createCmdFlow } from "@cmdflow/core";
import { createIndexedDBRankingStore } from "@cmdflow/dom/persistence";

const storage = createIndexedDBRankingStore({
  databaseName: "my-product-command-history",
  queryRetention: "fingerprint", // The browser adapter's default.
  onDiagnostic: ({ code }) => console.debug("Command history:", code),
});

const flow = createCmdFlow({
  id: "command-panel",
  commands: [
    {
      id: "github-issues",
      title: "GitHub issues",
      run: () => ({ type: "stay" }),
    },
  ],
  ranking: {
    store: storage,
    queryPolicy: storage.getQueryPolicy,
    scope: {
      subjectKey: "opaque-account-key",
      surfaceId: "product-command-panel",
      contextKey: "opaque-workspace-key", // Optional.
    },
  },
});

flow.open(); // Opening does not wait for IndexedDB or cryptography.
flow.setQuery("github");

// When this owner is disposed:
flow.destroy();
storage.destroy();
```

Create the browser store in the browser lifecycle and dispose both owners. Importing the module is
safe during server rendering. A store can be shared by multiple flows; destroy it only after all
its consumers are disposed. Supply both `store` and `queryPolicy`: the latter derives compatible
query keys for the browser adapter.

Use stable, opaque subject and context identifiers. CmdFlow never derives them from a URL, selected
text, document title, or application context. Core separates navigation views using the collision-safe
`createRankingSurfaceId(surfaceId, surface, viewId)` helper from `@cmdflow/core`. Use that helper
when constructing a low-level view-specific reset/load scope; do not concatenate delimiters.
Contextual actions credit the originating item's query and scope,
including when the action panel has its own search text.

## Privacy choices

| `queryRetention` | Stored query information |
| --- | --- |
| `"none"` | No query associations. Scoped item frequency and recency still work. |
| `"fingerprint"` | A keyed digest of the exact normalized query. This is the browser default. |
| `"plain"` | Normalized query text. Explicit opt-in only. |

Fingerprints use a random, non-extractable HMAC-SHA-256 key per subject profile. The signed input
includes the algorithm and normalization versions, subject, surface, and query kind. The key and
its opaque identifier live in IndexedDB. Missing or incompatible keys cause old query associations
to be removed before a replacement profile key is installed. Different subjects receive different
keys.

The adapter stores candidate IDs, opaque scope/query keys, fixed-point counters, timestamps,
versions, operation IDs for deduplication, and profile metadata. It does not store result payloads,
form values, passwords, arbitrary application context, or DOM data. Keep personal information out
of IDs too. Fingerprints reveal equality and frequency patterns and do not protect against
same-origin code or XSS; they are not encryption of a secure user vault.

History expires 180 days after its last successful use, independently of its score. Values decay
daily using the core's versioned integer algorithm. Each subject has a default quota of 5,000
aggregate records, adjustable through `maxRecords`. Expired and very low-value records are removed
first; quota eviction then uses decayed value, last-use time, and canonical record key. One operation
can create up to four aggregates, so the quota is a record limit, not an item limit.

## Reset and account changes

Use the active flow's reset method so it also invalidates pending feedback from that flow:

```ts
await flow.resetRanking(); // All learned history for this flow's subject.

await flow.resetRanking({
  type: "item",
  subjectKey: "opaque-account-key",
  candidateId: selectedItem.candidateId,
});
```

Other selectors are `query`, `surface`, and `fingerprint`; `all` without a subject clears every
subject in the database. Query reset accepts a derived `RankingQueryKey`, not raw text. Item reset
removes that candidate's query, contextual, and surface aggregates. Favorites and aliases are
explicit command settings and are unaffected.

On logout or a shared-device transition, reset the old subject and dispose its flows and store
before creating owners for the new subject. Account-wide reset also rotates that profile's key.
The lower-level `storage.reset(...)` is available to hosts coordinating several owners; it does
not cancel application work running in another flow or tab. Coordinate those owners when a reset
must fence in-flight operations across the entire product.

## Availability and timing

`storage.ready` resolves when opening has succeeded or fallen back to memory. The default timeout
for opening and individual transactions is 1,500 milliseconds; `timeoutMs` customizes it.
Unavailable, blocked, denied, corrupted, or quota-limited storage emits a diagnostic and falls back
without blocking command execution. Missing cryptography disables query learning while retaining
item learning. A schema version change closes the connection and moves that store instance to
memory; construct a fresh store to reconnect.

Feedback updates every affected aggregate and its deduplication record in one IndexedDB transaction.
A write failure aborts the whole transaction. Each completed mutation broadcasts only an opaque
`{ namespace, revision }` invalidation. Other tabs reload authoritative data from IndexedDB; they do
not trust record payloads sent over the channel. BroadcastChannel is best-effort and local to the
browser origin. There is no server synchronization.

`flow.invoke()` resolves the action outcome before its history write finishes. The
`ranking-feedback` diagnostic event is emitted after a successful feedback commit and subsequent
hydration. Do not treat action success or `storage.ready` as a durable-write acknowledgment. The
flow's `rankingReady` snapshot becomes true after its initial profile hydration attempt settles;
it is not a signal that every query fingerprint or background write has finished. Hydration can
preserve the currently active candidate even when its displayed position changes. Late updates
are deferred after keyboard/pointer navigation to avoid moving the user's target.

## Current limits

- Storage fallback retains this tab's recent successful activity in memory; it does not mirror all
  previously persisted or other-tab history. Memory-only changes do not survive reloads.
- Pending writes are not guaranteed during page termination. No unload handler or automatic
  persistent-storage permission request is installed.
- Deduplication tombstones remain for the bounded retention window after reset, preventing an
  already-committed operation from recreating deleted history.
- The adapter reads one subject's bounded record collection for a transaction. Large installations
  should measure their own quota, storage latency, and rendering workload before increasing limits.
- The browser implementation has injectable `indexedDB`, `crypto`, `now`, and `createChannel` options
  for deterministic tests. Local tests cover concurrent transactions, reopening, HMAC isolation,
  corruption, key rotation, resets, failed writes, and fallback; browser-specific storage policies
  can still differ.
