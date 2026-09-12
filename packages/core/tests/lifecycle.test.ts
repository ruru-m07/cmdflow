import { describe, expect, test } from "bun:test";
import type { ActionOutcome, FeedbackCommit, RankingStore, ViewDefinition } from "../src/index.js";
import { createCmdFlow, createMemoryRankingStore } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

describe("lifecycle regression contracts", () => {
  test("programmatic invocation cannot navigate an implicit current panel", async () => {
    let ran = 0;
    const flow = createCmdFlow({
      commands: [
        {
          id: "close",
          title: "Close",
          run: () => {
            ran++;
            return { type: "close" };
          },
        },
      ],
    });
    flow.open();
    await flow.invoke();
    expect(ran).toBe(1);
    expect(flow.getSnapshot().open).toBe(true);
    await flow.invoke({ address: { surface: "main", frameId: flow.getSnapshot().current.id } });
    expect(flow.getSnapshot().open).toBe(false);
    flow.destroy();
  });
  test("controlled composition completion unlocks navigation even before host accepts text", () => {
    const flow = createCmdFlow({ controlledQuery: true, commands: [{ id: "x", title: "X" }] });
    flow.open();
    flow.setQuery("x", undefined, true);
    flow.setQuery("x", undefined, false);
    expect(flow.getSnapshot().current.composing).toBe(false);
    expect(flow.getSnapshot().current.query).toBe("");
    flow.destroy();
  });
  test("sources cannot use reserved identity namespaces", () => {
    const flow = createCmdFlow();
    for (const id of ["registry", "view:root"])
      expect(() =>
        flow.registerSource({
          id,
          search: () => ({ operation: "replace", items: [], done: true }),
        }),
      ).toThrow("Reserved");
    flow.destroy();
  });
  test("parent eligibility is reevaluated when invoking a child action", async () => {
    let enabled = true;
    let ran = false;
    const flow = createCmdFlow({
      commands: [
        {
          id: "a",
          title: "A",
          enabled: () => enabled,
          actions: [
            {
              id: "run",
              title: "Run",
              run: () => {
                ran = true;
              },
            },
          ],
        },
      ],
    });
    flow.open();
    enabled = false;
    expect((await flow.invoke()).status).toBe("disabled");
    expect(ran).toBe(false);
    flow.destroy();
  });
  test("predicates receive their item on the very first snapshot", () => {
    const flow = createCmdFlow({
      commands: [
        {
          id: "a",
          title: "A",
          data: { allowed: true },
          actions: [
            {
              id: "run",
              title: "Run",
              enabled: ({ item }) => (item?.data as { allowed: boolean })?.allowed ?? false,
              run() {},
            },
          ],
        },
      ],
    });
    expect(flow.getSnapshot().current.actions[0]?.disabled).toBe(false);
    flow.destroy();
  });
  test("disposing a source aborts its in-flight action even if transport ignores abort", async () => {
    const pending = deferred<ActionOutcome<Record<string, never>>>();
    const flow = createCmdFlow();
    const dispose = flow.registerSource({
      id: "remote",
      search: () => ({
        operation: "replace",
        done: true,
        items: [{ id: "a", title: "A", run: () => pending.promise }],
      }),
    });
    flow.open();
    await tick();
    const execution = flow.invoke({
      address: { surface: "main", frameId: flow.getSnapshot().current.id },
    });
    dispose();
    expect((await execution).status).toBe("aborted");
    pending.resolve({ type: "push-view", view: { id: "stale", type: "detail" } });
    await tick();
    expect(flow.getSnapshot().current.view.id).toBe("root");
    flow.destroy();
  });
  test("a disposed destructive command cannot be resurrected by its confirmation", async () => {
    let ran = false;
    const flow = createCmdFlow();
    const dispose = flow.registerCommand({
      id: "delete",
      title: "Delete",
      destructive: true,
      priority: "primary",
      run: () => {
        ran = true;
      },
    });
    flow.open();
    await flow.invoke();
    dispose();
    await flow.confirm();
    expect(ran).toBe(false);
    flow.destroy();
  });
  test("reentrant cancellation before action.run prevents application work", async () => {
    let ran = false;
    const flow = createCmdFlow({
      commands: [
        {
          id: "a",
          title: "A",
          run: () => {
            ran = true;
          },
        },
      ],
    });
    flow.open();
    flow.subscribe(() => {
      if (flow.getSnapshot().executions.some((execution) => execution.status === "pending"))
        flow.close();
    });
    expect((await flow.invoke()).status).toBe("aborted");
    expect(ran).toBe(false);
    flow.destroy();
  });
  test("feedback uses the invocation query and cannot delay UI outcomes", async () => {
    const action = deferred<ActionOutcome<Record<string, never>>>();
    const persisted = deferred<void>();
    const commits: FeedbackCommit[] = [];
    const memory = createMemoryRankingStore({ allowPlainQueryKeys: true });
    const storage: RankingStore = {
      ...memory,
      commit: async (commit) => {
        commits.push(commit);
        await persisted.promise;
      },
    };
    const flow = createCmdFlow({
      ranking: { store: storage, scope: { subjectKey: "test", surfaceId: "test" } },
      commands: [{ id: "a", title: "GitHub", run: () => action.promise }],
    });
    flow.open();
    flow.setQuery("github");
    const execution = flow.invoke({
      address: { surface: "main", frameId: flow.getSnapshot().current.id },
    });
    flow.setQuery("later query");
    action.resolve({ type: "close" });
    expect((await execution).status).toBe("success");
    expect(flow.getSnapshot().open).toBe(false);
    await tick();
    expect(commits[0]?.queryKey).toEqual({ strategy: "plain", value: "github" });
    persisted.resolve();
    await tick();
    flow.destroy();
  });
  test("successful form submit closes cleanly; subsequent edits remain dirty", async () => {
    const flow = createCmdFlow();
    flow.open();
    flow.push({
      id: "form",
      type: "form",
      fields: [{ id: "title", label: "Title" }],
      submit: { id: "save", title: "Save", run: () => ({ type: "close" }) },
    });
    flow.setField("title", "Ready");
    expect((await flow.submitForm()).status).toBe("success");
    expect(flow.getSnapshot().open).toBe(false);
    expect(flow.getSnapshot().confirmation).toBeNull();
    flow.destroy();
  });
  test("canceling a nested dirty form preserves the parent's dirty state", async () => {
    const form = (id: string): ViewDefinition<Record<string, never>> => ({
      id,
      type: "form",
      fields: [{ id: "text", label: "Text" }],
    });
    const flow = createCmdFlow();
    flow.open();
    flow.push(form("parent"));
    flow.setField("text", "parent draft");
    flow.push(form("child"));
    flow.setField("text", "child draft");
    flow.pop();
    await flow.confirm();
    expect(flow.getSnapshot().current.form.dirty).toBe(true);
    expect(flow.getSnapshot().current.form.values.text).toBe("parent draft");
    flow.destroy();
  });
  test("closing aborts signal-ignoring validation and settles submission", async () => {
    let signal: AbortSignal | undefined;
    const flow = createCmdFlow();
    flow.open();
    flow.push({
      id: "form",
      type: "form",
      fields: [
        {
          id: "text",
          label: "Text",
          validate: (_, input) => {
            signal = input.signal;
            return new Promise(() => {});
          },
        },
      ],
      submit: { id: "save", title: "Save", run() {} },
    });
    const submission = flow.submitForm();
    flow.setOpen(false);
    expect(signal?.aborted).toBe(true);
    expect((await submission).status).toBe("aborted");
    flow.destroy();
  });
});
