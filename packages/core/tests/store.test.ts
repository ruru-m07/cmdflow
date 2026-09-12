import { describe, expect, test } from "bun:test";
import type { CommandDefinition, ResultBatch, ViewDefinition } from "../src/index.js";
import {
  createCandidateId,
  createCmdFlow,
  createContextStore,
  createMemoryRankingStore,
  createRankingSurfaceId,
  parseCandidateId,
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected fixture value to exist");
  return value;
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
function commands(count = 10): CommandDefinition<Record<string, never>>[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `github-${i}`,
    title: `GitHub result ${i}`,
    keywords: ["github"],
    run: () => ({ type: "stay" as const }),
  }));
}

describe("CmdFlow registry and immutable store", () => {
  test("candidate IDs are collision safe and roundtrip", () => {
    expect(createCandidateId("a:b", "c")).not.toBe(createCandidateId("a", "b:c"));
    expect(parseCandidateId(createCandidateId('a"', "你好"))).toEqual(['a"', "你好"]);
  });
  test("snapshots are cached, immutable, and subscriptions dispose", () => {
    const flow = createCmdFlow({ commands: commands(2) });
    const before = flow.getSnapshot();
    expect(flow.getSnapshot()).toBe(before);
    let calls = 0;
    const off = flow.subscribe(() => calls++);
    flow.open();
    expect(flow.getSnapshot()).not.toBe(before);
    expect(calls).toBeGreaterThan(0);
    expect(Object.isFrozen(flow.getSnapshot().current.items)).toBe(true);
    expect(Object.isFrozen(flow.getSnapshot().current.items[0])).toBe(true);
    off();
    const current = calls;
    flow.setQuery("result");
    expect(calls).toBe(current);
    expect(flow.getServerSnapshot()).toBe(before);
    flow.destroy();
  });
  test("registration is atomic and disposal cannot remove someone else's data", () => {
    const flow = createCmdFlow({ commands: commands(1) });
    expect(() =>
      flow.registerExtension({
        id: "duplicate",
        commands: [
          { id: "new", title: "New" },
          { id: "github-0", title: "Duplicate" },
        ],
      }),
    ).toThrow();
    expect(flow.getSnapshot().current.items.map((item) => item.id)).toEqual(["github-0"]);
    const off = flow.registerExtension({
      id: "extra",
      commands: [{ id: "other", title: "Other" }],
    });
    expect(flow.getSnapshot().current.items).toHaveLength(2);
    off();
    off();
    expect(flow.getSnapshot().current.items).toHaveLength(1);
    flow.destroy();
  });
  test("reactive context updates visibility and disabled state", async () => {
    const context = createContextStore({ connected: false, online: false });
    let called = 0;
    const flow = createCmdFlow({
      context,
      commands: [
        {
          id: "github",
          title: "GitHub",
          visible: ({ appContext }) => appContext.connected,
          enabled: ({ appContext }) => appContext.online || { reason: "Offline" },
          run: () => {
            called++;
          },
        },
      ],
    });
    expect(flow.getSnapshot().current.items).toHaveLength(0);
    context.set({ connected: true, online: false });
    expect(flow.getSnapshot().current.items[0]?.disabledReason).toBe("Offline");
    expect((await flow.invoke()).status).toBe("disabled");
    expect(called).toBe(0);
    context.set({ connected: true, online: true });
    flow.open();
    expect((await flow.invoke()).status).toBe("success");
    expect(called).toBe(1);
    flow.destroy();
  });
  test("throwing predicate is isolated from other commands", () => {
    const events: string[] = [];
    const flow = createCmdFlow({
      commands: [
        ...commands(1),
        {
          id: "bad",
          title: "Bad",
          visible: () => {
            throw new Error("bad");
          },
        },
      ],
      onDiagnostic: (event) => events.push(event.type),
    });
    expect(flow.getSnapshot().current.items).toHaveLength(1);
    expect(events).toContain("command-error");
    flow.destroy();
  });
  test("controlled open/query report requests and await host values", () => {
    const opens: boolean[] = [];
    const queries: string[] = [];
    const flow = createCmdFlow({
      controlledOpen: true,
      controlledQuery: true,
      onOpenChange: (value) => opens.push(value),
      onQueryChange: (value) => queries.push(value),
    });
    flow.open();
    expect(flow.getSnapshot().open).toBe(false);
    expect(opens).toEqual([true]);
    flow.setOpen(true);
    flow.setQuery("github");
    expect(queries).toEqual(["github"]);
    expect(flow.getSnapshot().current.query).toBe("");
    flow.syncQuery("github");
    expect(flow.getSnapshot().current.query).toBe("github");
    flow.close();
    expect(flow.getSnapshot().open).toBe(true);
    flow.destroy();
  });
});

describe("navigation and contextual actions", () => {
  test("action stack is separate; submenu/back preserves the root query, active item and anchor", async () => {
    const flow = createCmdFlow({
      commands: [
        {
          id: "issue",
          title: "GitHub Issue",
          actions: [
            {
              id: "state",
              title: "Change state",
              children: [{ id: "close", title: "Close issue", run: () => ({ type: "stay" }) }],
            },
          ],
        },
      ],
    });
    flow.open();
    flow.setQuery("github");
    const root = flow.getSnapshot().current;
    const active = required(root.activeId);
    flow.setScrollAnchor({ candidateId: active, offset: 12 });
    flow.openActions();
    expect(flow.getSnapshot().main).toHaveLength(1);
    expect(flow.getSnapshot().actions).toHaveLength(1);
    const actionFrame = required(flow.getSnapshot().actionFrame);
    await flow.invoke({ address: { surface: "actions", frameId: actionFrame.id } });
    expect(flow.getSnapshot().actions).toHaveLength(2);
    flow.escape();
    expect(flow.getSnapshot().actions).toHaveLength(1);
    flow.escape();
    expect(flow.getSnapshot().actions).toHaveLength(0);
    expect(flow.getSnapshot().current.query).toBe("github");
    expect(flow.getSnapshot().current.activeId).toBe(active);
    expect(flow.getSnapshot().current.scrollAnchor?.offset).toBe(12);
    flow.destroy();
  });
  test("nested view back restores parent selection; composing Escape does nothing", () => {
    const flow = createCmdFlow({ commands: commands(3) });
    flow.open();
    flow.setQuery("github");
    flow.moveActive("next");
    const selected = flow.getSnapshot().current.activeId;
    flow.push({ id: "child", type: "list", items: [{ id: "one", title: "One" }] });
    flow.setQuery("字", undefined, true);
    flow.escape();
    expect(flow.getSnapshot().main).toHaveLength(2);
    flow.setQuery("字", undefined, false);
    flow.escape();
    expect(flow.getSnapshot().main).toHaveLength(1);
    expect(flow.getSnapshot().current.activeId).toBe(selected);
    flow.escape();
    expect(flow.getSnapshot().current.query).toBe("");
    flow.escape();
    expect(flow.getSnapshot().open).toBe(false);
    flow.destroy();
  });
  test("disabled items remain navigable but cannot invoke or select", async () => {
    let called = 0;
    const flow = createCmdFlow({
      root: { id: "root", type: "list", selectionMode: "multiple" },
      commands: [
        {
          id: "disabled",
          title: "Disabled",
          disabled: { reason: "Unavailable" },
          run: () => {
            called++;
          },
        },
      ],
    });
    flow.open();
    const active = required(flow.getSnapshot().current.activeId);
    expect(active).not.toBeNull();
    flow.toggleSelected(active);
    expect(flow.getSnapshot().current.selectedIds).toHaveLength(0);
    expect((await flow.invoke()).status).toBe("disabled");
    expect(called).toBe(0);
    flow.destroy();
  });
  test("destructive action waits for an explicit confirmation", async () => {
    let called = 0;
    const flow = createCmdFlow({
      commands: [
        {
          id: "delete",
          title: "Delete",
          destructive: true,
          priority: "primary",
          run: () => {
            called++;
          },
        },
      ],
    });
    flow.open();
    expect((await flow.invoke()).status).toBe("confirmation");
    expect(called).toBe(0);
    await flow.confirm();
    expect(called).toBe(1);
    expect(flow.getSnapshot().confirmation).toBeNull();
    flow.destroy();
  });
  test("an old detached execution cannot close a reopened panel", async () => {
    const pending = deferred<{ type: "close" }>();
    const flow = createCmdFlow({
      commands: [{ id: "slow", title: "Slow", lifecycle: "detached", run: () => pending.promise }],
    });
    flow.open();
    const execution = flow.invoke({
      address: { surface: "main", frameId: flow.getSnapshot().current.id },
    });
    flow.close();
    flow.open();
    pending.resolve({ type: "close" });
    expect((await execution).status).toBe("success");
    expect(flow.getSnapshot().open).toBe(true);
    flow.destroy();
  });
  test("popping a frame aborts its pending action", async () => {
    const pending = deferred<void>();
    let signal: AbortSignal | undefined;
    const flow = createCmdFlow();
    flow.open();
    flow.push({
      id: "child",
      type: "list",
      items: [
        {
          id: "slow",
          title: "Slow",
          run: (input) => {
            signal = input.signal;
            return pending.promise;
          },
        },
      ],
    });
    const execution = flow.invoke();
    flow.pop();
    expect(signal?.aborted).toBe(true);
    pending.resolve();
    expect((await execution).status).toBe("aborted");
    flow.destroy();
  });
});

describe("providers", () => {
  test("same local ID in different sources remains distinct and invokes the right item", async () => {
    const called: string[] = [];
    const flow = createCmdFlow({
      sources: ["a", "b"].map((id) => ({
        id,
        search: () => ({
          operation: "replace" as const,
          done: true as const,
          items: [
            {
              id: "1",
              title: id,
              run: () => {
                called.push(id);
              },
            },
          ],
        }),
      })),
    });
    flow.open();
    await tick();
    const items = flow.getSnapshot().current.items;
    expect(items).toHaveLength(2);
    expect(items[0]?.candidateId).not.toBe(items[1]?.candidateId);
    await flow.invoke({ candidateId: items[1]?.candidateId });
    expect(called).toEqual(["b"]);
    flow.destroy();
  });
  test("stale queries cannot replace current results even when transport ignores abort", async () => {
    const requests = new Map<
      string,
      ReturnType<typeof deferred<ResultBatch<Record<string, never>>>>
    >();
    const flow = createCmdFlow({
      sources: [
        {
          id: "remote",
          search: (request) => {
            const pending = deferred<ResultBatch<Record<string, never>>>();
            requests.set(request.rawQuery, pending);
            return pending.promise as Promise<
              Extract<ResultBatch<Record<string, never>>, { done: true }>
            >;
          },
        },
      ],
    });
    flow.open();
    flow.setQuery("old");
    flow.setQuery("new");
    required(requests.get("new")).resolve({
      operation: "replace",
      done: true,
      items: [{ id: "new", title: "New" }],
    });
    await tick();
    required(requests.get("old")).resolve({
      operation: "replace",
      done: true,
      items: [{ id: "old", title: "Old" }],
    });
    await tick();
    expect(flow.getSnapshot().current.items.map((item) => item.id)).toEqual(["new"]);
    flow.destroy();
  });
  test("provider errors isolate successful peers and retryable pages accumulate", async () => {
    const flow = createCmdFlow({
      sources: [
        {
          id: "bad",
          search: () => {
            throw new Error("offline");
          },
        },
        {
          id: "good",
          search: ({ cursor }) =>
            cursor
              ? {
                  operation: "patch",
                  done: true,
                  items: [{ id: "2", title: "Two", providerRank: 2 }],
                }
              : {
                  operation: "replace",
                  done: true,
                  nextCursor: "page-2",
                  items: [{ id: "1", title: "One", providerRank: 1 }],
                },
        },
      ],
    });
    flow.open();
    await tick();
    expect(flow.getSnapshot().current.sources.find((source) => source.id === "bad")?.status).toBe(
      "error",
    );
    expect(flow.getSnapshot().current.items).toHaveLength(1);
    await flow.loadMore("good");
    expect(flow.getSnapshot().current.items).toHaveLength(2);
    flow.destroy();
  });
  test("composition changes input but does not launch providers until committed", async () => {
    const searched: string[] = [];
    const flow = createCmdFlow({
      sources: [
        {
          id: "source",
          search: ({ rawQuery }) => {
            searched.push(rawQuery);
            return { operation: "replace", items: [], done: true };
          },
        },
      ],
    });
    flow.open();
    await tick();
    flow.setQuery("日", undefined, true);
    flow.setQuery("日本", undefined, true);
    expect(searched).toEqual([""]);
    expect(flow.getSnapshot().current.query).toBe("日本");
    flow.setQuery("日本", undefined, false);
    await tick();
    expect(searched).toEqual(["", "日本"]);
    flow.destroy();
  });
});

describe("learning and forms", () => {
  test("success promotes the sixth relevant result and reset restores cold order", async () => {
    const flow = createCmdFlow({ commands: commands() });
    flow.open();
    flow.setQuery("github");
    await tick();
    const sixth = required(flow.getSnapshot().current.items[5]);
    flow.setActive(sixth.candidateId);
    await flow.invoke();
    flow.close();
    flow.open();
    flow.setQuery("github");
    await tick();
    expect(flow.getSnapshot().current.items[0]?.candidateId).toBe(sixth.candidateId);
    expect(flow.explainRanking()[0]?.exactSurfaceAffinityFixed).toBeGreaterThan(0);
    await flow.resetRanking();
    flow.setQuery("");
    flow.setQuery("github");
    expect(flow.getSnapshot().current.items[0]?.id).toBe("github-0");
    flow.destroy();
  });
  test("highlight and failed actions do not create positive history", async () => {
    const storage = createMemoryRankingStore({ allowPlainQueryKeys: true });
    const flow = createCmdFlow({
      ranking: { store: storage, scope: { subjectKey: "test", surfaceId: "test" } },
      commands: [
        {
          id: "fail",
          title: "Fail",
          run: () => {
            throw new Error("failure");
          },
        },
      ],
    });
    flow.open();
    flow.setQuery("fail");
    await flow.invoke();
    const profile = await storage.load({
      scope: { subjectKey: "test", surfaceId: createRankingSurfaceId("test", "main", "root") },
      now: Date.now(),
    });
    expect(profile.records).toHaveLength(0);
    flow.destroy();
  });
  test("forms validate, preserve drafts on nested navigation, exclude secure values, and submit", async () => {
    let submitted: unknown;
    const form: ViewDefinition<Record<string, never>> = {
      id: "form",
      type: "form",
      fields: [
        { id: "title", label: "Title", required: true },
        { id: "password", label: "Password", type: "password" },
      ],
      submit: {
        id: "save",
        title: "Save",
        run: ({ values }) => {
          submitted = values;
        },
      },
    };
    const flow = createCmdFlow();
    flow.open();
    flow.push(form);
    expect((await flow.submitForm()).status).toBe("error");
    expect(flow.getSnapshot().current.form.errors.title).toBe("Title is required");
    flow.setField("title", "Fix bug");
    flow.setField("password", "secret");
    expect(flow.getSafeDraft()).toEqual({ title: "Fix bug" });
    flow.push({ id: "picker", type: "list" });
    flow.pop();
    expect(flow.getSnapshot().current.form.values.title).toBe("Fix bug");
    expect((await flow.submitForm()).status).toBe("success");
    expect(submitted).toEqual({ title: "Fix bug", password: "secret" });
    expect(flow.getSnapshot().current.form.dirty).toBe(false);
    flow.destroy();
  });
  test("dirty form close is confirmed; canceled confirmation keeps values", async () => {
    const flow = createCmdFlow();
    flow.open();
    flow.push({ id: "form", type: "form", fields: [{ id: "title", label: "Title" }] });
    flow.setField("title", "draft");
    flow.close();
    expect(flow.getSnapshot().open).toBe(true);
    expect(flow.getSnapshot().confirmation?.kind).toBe("discard");
    flow.cancelConfirmation();
    expect(flow.getSnapshot().current.form.values.title).toBe("draft");
    flow.close();
    await flow.confirm();
    expect(flow.getSnapshot().open).toBe(false);
    flow.destroy();
  });
});
