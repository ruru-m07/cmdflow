import { afterEach, describe, expect, test } from "bun:test";
import { createCandidateId, createCmdFlow, createContextStore } from "../src/index.js";
import type {
  CmdFlow,
  FinalResultBatch,
  ResultBatch,
  ResultSource,
  SearchRequest,
} from "../src/types.js";

type Context = Record<string, never>;
const flows = new Set<{ destroy(): void }>();
afterEach(() => {
  for (const flow of flows) flow.destroy();
  flows.clear();
});

async function settle(): Promise<void> {
  for (let at = 0; at < 20; at += 1) await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** A controllable producer that deliberately continues yielding after cancellation. */
function stream<T = Context>() {
  const queued: IteratorResult<ResultBatch<T>>[] = [];
  let pending: ReturnType<typeof deferred<IteratorResult<ResultBatch<T>>>> | undefined;
  let returns = 0;
  const iterator: AsyncIterableIterator<ResultBatch<T>> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next() {
      const queuedItem = queued.shift();
      if (queuedItem) return Promise.resolve(queuedItem);
      pending = deferred<IteratorResult<ResultBatch<T>>>();
      return pending.promise;
    },
    return() {
      returns += 1;
      return Promise.resolve({ done: true, value: undefined });
    },
  };
  function deliver(next: IteratorResult<ResultBatch<T>>) {
    if (pending) {
      const waiter = pending;
      pending = undefined;
      waiter.resolve(next);
    } else queued.push(next);
  }
  return {
    iterator,
    emit(batch: ResultBatch<T>) {
      deliver({ done: false, value: batch });
    },
    finish() {
      deliver({ done: true, value: undefined });
    },
    get returnCalls() {
      return returns;
    },
  };
}

function itemIds(flow: Pick<CmdFlow, "getSnapshot">): string[] {
  return flow.getSnapshot().current.items.map((item) => item.id);
}

describe("streamed result source conformance", () => {
  test("replace and patch are source-local; removal precedes upsert and duplicates use the last value", async () => {
    const producer = stream();
    const diagnostics: string[] = [];
    const flow = createCmdFlow({
      commands: [{ id: "registry", title: "Registry command" }],
      sources: [{ id: "stream", search: () => producer.iterator }],
      onDiagnostic: (event) => diagnostics.push(event.type),
    });
    flows.add(flow);
    flow.open();
    producer.emit({
      operation: "replace",
      items: [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
      ],
      done: false,
    });
    await settle();
    expect(itemIds(flow).sort()).toEqual(["a", "b", "registry"]);
    expect(flow.getSnapshot().current.sources[0]?.status).toBe("loading");
    const b = createCandidateId("stream", "b");
    flow.setActive(b);
    flow.setScrollAnchor({ candidateId: b, offset: 12 });
    producer.emit({
      operation: "patch",
      remove: ["a", "b"],
      items: [
        { id: "b", title: "Updated B" },
        { id: "c", title: "C" },
      ],
      done: false,
    });
    await settle();
    expect(itemIds(flow).sort()).toEqual(["b", "c", "registry"]);
    expect(flow.getSnapshot().current.activeId).toBe(b);
    expect(flow.getSnapshot().current.scrollAnchor).toEqual({ candidateId: b, offset: 12 });
    expect(flow.getSnapshot().current.items.find((item) => item.id === "b")?.title).toBe(
      "Updated B",
    );
    producer.emit({ operation: "replace", items: [{ id: "d", title: "D" }], done: false });
    await settle();
    expect(itemIds(flow).sort()).toEqual(["d", "registry"]);
    producer.emit({
      operation: "patch",
      items: [
        { id: "d", title: "First" },
        { id: "d", title: "Last" },
      ],
      done: true,
    });
    await settle();
    expect(flow.getSnapshot().current.items.find((item) => item.id === "d")?.title).toBe("Last");
    expect(flow.getSnapshot().current.sources[0]?.status).toBe("success");
    expect(diagnostics).toContain("duplicate-source-item");
    expect(producer.returnCalls).toBe(1);
  });

  test("natural iterator completion closes an unfinished page with a diagnostic and no cursor", async () => {
    const producer = stream();
    const diagnostics: string[] = [];
    const flow = createCmdFlow({
      sources: [{ id: "stream", search: () => producer.iterator }],
      onDiagnostic: (event) => diagnostics.push(event.type),
    });
    flows.add(flow);
    flow.open();
    producer.emit({ operation: "replace", items: [{ id: "a", title: "A" }], done: false });
    await settle();
    producer.finish();
    await settle();
    expect(flow.getSnapshot().current.sources[0]?.status).toBe("success");
    expect(flow.getSnapshot().current.sources[0]?.nextCursor).toBeUndefined();
    expect(itemIds(flow)).toEqual(["a"]);
    expect(diagnostics.filter((type) => type === "source-missing-final")).toHaveLength(1);
  });

  test("late page results cannot replace a newer query or restore its old cursor", async () => {
    const oldPage = deferred<FinalResultBatch<Context>>();
    const newQuery = deferred<FinalResultBatch<Context>>();
    const requests: SearchRequest<Context>[] = [];
    const flow = createCmdFlow({
      sources: [
        {
          id: "remote",
          minQueryLength: 1,
          search(request) {
            requests.push(request);
            if (request.cursor) return oldPage.promise;
            if (request.rawQuery === "new") return newQuery.promise;
            return {
              operation: "replace",
              items: [{ id: "old-1", title: "Old one" }],
              done: true,
              nextCursor: "old-page-2",
            };
          },
        },
      ],
    });
    flows.add(flow);
    flow.open();
    flow.setQuery("old");
    await settle();
    const oldEpoch = flow.getSnapshot().current.sources[0]?.searchEpoch;
    const pendingPage = flow.loadMore("remote");
    const pageRequest = requests.find((request) => request.cursor === "old-page-2");
    flow.setQuery("new");
    expect(pageRequest?.signal.aborted).toBe(true);
    newQuery.resolve({
      operation: "replace",
      items: [{ id: "new-1", title: "New one" }],
      done: true,
      nextCursor: "new-page-2",
    });
    await settle();
    oldPage.resolve({
      operation: "patch",
      items: [{ id: "old-2", title: "Old two" }],
      done: true,
      nextCursor: "old-page-3",
    });
    await pendingPage;
    await settle();
    expect(itemIds(flow)).toEqual(["new-1"]);
    expect(flow.getSnapshot().current.sources[0]).toMatchObject({
      status: "success",
      nextCursor: "new-page-2",
    });
    expect(flow.getSnapshot().current.sources[0]?.searchEpoch).toBeGreaterThan(oldEpoch ?? 0);
  });

  test("context replacement aborts the old request even when its query is unchanged", async () => {
    const context = createContextStore({ workspace: "first" });
    const pending = new Map<
      string,
      ReturnType<typeof deferred<FinalResultBatch<{ workspace: string }>>>
    >();
    const requests: SearchRequest<{ workspace: string }>[] = [];
    const flow = createCmdFlow({
      context,
      sources: [
        {
          id: "remote",
          minQueryLength: 1,
          search(request) {
            requests.push(request);
            const response = deferred<FinalResultBatch<{ workspace: string }>>();
            pending.set(request.context.workspace, response);
            return response.promise;
          },
        },
      ],
    });
    flows.add(flow);
    flow.open();
    flow.setQuery("issue");
    context.set({ workspace: "second" });
    expect(requests[0]?.signal.aborted).toBe(true);
    expect(requests[1]?.context).toEqual({ workspace: "second" });
    pending.get("second")?.resolve({
      operation: "replace",
      items: [{ id: "second", title: "Issue second" }],
      done: true,
    });
    await settle();
    pending.get("first")?.resolve({
      operation: "replace",
      items: [{ id: "first", title: "Issue first" }],
      done: true,
    });
    await settle();
    expect(itemIds(flow)).toEqual(["second"]);
    expect(flow.getSnapshot().current.query).toBe("issue");
  });

  test("a reentrant source-start diagnostic can close the panel before transport begins", async () => {
    let calls = 0;
    let flow: CmdFlow<Context> | undefined;
    flow = createCmdFlow({
      sources: [
        {
          id: "remote",
          search() {
            calls += 1;
            return { operation: "replace", items: [], done: true };
          },
        },
      ],
      onDiagnostic(event) {
        if (event.type === "source-start") flow?.close();
      },
    });
    flows.add(flow);
    flow.open();
    await settle();
    expect(flow.getSnapshot().open).toBe(false);
    expect(calls).toBe(0);
    expect(itemIds(flow)).toEqual([]);
  });

  test.each([false, true])(
    "closing from a batch diagnostic cancels the iterator exactly once (final=%s)",
    async (final) => {
      const producer = stream();
      let signal: AbortSignal | undefined;
      let flow: CmdFlow<Context> | undefined;
      flow = createCmdFlow({
        sources: [
          {
            id: "remote",
            search(request) {
              signal = request.signal;
              return producer.iterator;
            },
          },
        ],
        onDiagnostic(event) {
          if (event.type === "source-batch") flow?.close();
        },
      });
      flows.add(flow);
      flow.open();
      producer.emit({
        operation: "replace",
        items: [{ id: "visible", title: "Visible" }],
        done: final,
      });
      await settle();
      expect(flow.getSnapshot().open).toBe(false);
      expect(signal?.aborted).toBe(true);
      expect(producer.returnCalls).toBe(1);
      producer.emit({ operation: "replace", items: [{ id: "late", title: "Late" }], done: true });
      await settle();
      expect(itemIds(flow)).toEqual(["visible"]);
    },
  );

  test("a synchronous iterator cleanup exception cannot prevent closing the panel", async () => {
    const pending = deferred<IteratorResult<ResultBatch<Context>>>();
    const iterable: AsyncIterableIterator<ResultBatch<Context>> = {
      [Symbol.asyncIterator]() {
        return this;
      },
      next: () => pending.promise,
      return() {
        throw new Error("Synchronous cleanup failure");
      },
    };
    const flow = createCmdFlow({ sources: [{ id: "remote", search: () => iterable }] });
    flows.add(flow);
    flow.open();
    expect(() => flow.close()).not.toThrow();
    expect(flow.getSnapshot().open).toBe(false);
    await settle();
  });

  test("a reentrant duplicate-item diagnostic cannot make the old batch corrupt a newer query", async () => {
    const old = stream();
    let flow: CmdFlow<Context> | undefined;
    flow = createCmdFlow({
      sources: [
        {
          id: "remote",
          minQueryLength: 1,
          search(request) {
            if (request.rawQuery === "old") return old.iterator;
            return {
              operation: "replace",
              items: [{ id: "new", title: "New result" }],
              done: true,
            };
          },
        },
      ],
      onDiagnostic(event) {
        if (event.type === "duplicate-source-item") flow?.setQuery("new");
      },
    });
    flows.add(flow);
    flow.open();
    flow.setQuery("old");
    old.emit({
      operation: "replace",
      items: [
        { id: "duplicate", title: "Old first" },
        { id: "duplicate", title: "Old last" },
      ],
      done: true,
    });
    await settle();
    expect(flow.getSnapshot().current.query).toBe("new");
    expect(itemIds(flow)).toEqual(["new"]);
    expect(flow.getSnapshot().current.sources[0]?.status).toBe("success");
  });

  test("a page error preserves previous results and retry cursor, then clears the error on success", async () => {
    let pages = 0;
    let calls = 0;
    const flow = createCmdFlow({
      sources: [
        {
          id: "remote",
          search({ cursor }) {
            calls += 1;
            if (!cursor)
              return {
                operation: "replace",
                items: [{ id: "one", title: "One" }],
                done: true,
                nextCursor: "two",
              };
            pages += 1;
            if (pages === 1) return Promise.reject(new Error("Temporary failure"));
            return { operation: "patch", items: [{ id: "two", title: "Two" }], done: true };
          },
        },
      ],
    });
    flows.add(flow);
    flow.open();
    await settle();
    await flow.loadMore("remote");
    expect(itemIds(flow)).toEqual(["one"]);
    expect(flow.getSnapshot().current.sources[0]).toMatchObject({
      status: "error",
      error: "Temporary failure",
      nextCursor: "two",
    });
    await flow.loadMore("remote");
    expect(itemIds(flow)).toEqual(["one", "two"]);
    expect(flow.getSnapshot().current.sources[0]?.status).toBe("success");
    expect(flow.getSnapshot().current.sources[0]?.error).toBeUndefined();
    expect(flow.getSnapshot().current.sources[0]?.nextCursor).toBeUndefined();
    await flow.loadMore("remote");
    expect(calls).toBe(3);
    flow.refresh();
    await settle();
    expect(itemIds(flow)).toEqual(["one"]);
    expect(flow.getSnapshot().current.sources[0]?.nextCursor).toBe("two");
  });

  test("an invalid paginated replacement errors without deleting previously loaded items", async () => {
    const flow = createCmdFlow({
      sources: [
        {
          id: "remote",
          search({ cursor }) {
            return cursor
              ? { operation: "replace", items: [{ id: "wrong", title: "Wrong" }], done: true }
              : {
                  operation: "replace",
                  items: [{ id: "one", title: "One" }],
                  done: true,
                  nextCursor: "two",
                };
          },
        },
      ],
    });
    flows.add(flow);
    flow.open();
    await settle();
    await flow.loadMore("remote");
    expect(itemIds(flow)).toEqual(["one"]);
    expect(flow.getSnapshot().current.sources[0]).toMatchObject({
      status: "error",
      nextCursor: "two",
    });
  });

  test("a synchronous non-final response fails clearly and a refresh can recover", async () => {
    let broken = true;
    const source: ResultSource<Context> = {
      id: "remote",
      search: () =>
        ({
          operation: "replace",
          items: [{ id: "one", title: "One" }],
          done: !broken,
        }) as FinalResultBatch<Context>,
    };
    const flow = createCmdFlow({ sources: [source] });
    flows.add(flow);
    flow.open();
    await settle();
    expect(flow.getSnapshot().current.sources[0]?.status).toBe("error");
    expect(itemIds(flow)).toEqual([]);
    broken = false;
    flow.refresh();
    await settle();
    expect(flow.getSnapshot().current.sources[0]?.status).toBe("success");
    expect(itemIds(flow)).toEqual(["one"]);
  });

  test("a final batch remains successful even when iterator cleanup rejects", async () => {
    let returned = 0;
    const iterable: AsyncIterableIterator<ResultBatch<Context>> = {
      [Symbol.asyncIterator]() {
        return this;
      },
      next: async () => ({
        done: false,
        value: { operation: "replace", items: [{ id: "one", title: "One" }], done: true },
      }),
      return() {
        returned += 1;
        return Promise.reject(new Error("Cleanup failed"));
      },
    };
    const flow = createCmdFlow({ sources: [{ id: "remote", search: () => iterable }] });
    flows.add(flow);
    flow.open();
    await settle();
    expect(itemIds(flow)).toEqual(["one"]);
    expect(returned).toBe(1);
    expect(flow.getSnapshot().current.sources[0]?.status).toBe("success");
  });
});
