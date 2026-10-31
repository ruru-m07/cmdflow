import { expect, test } from "bun:test";
import { immutable } from "../src/identity.js";
import { createCmdFlow, createMemoryRankingStore, createRankingSurfaceId } from "../src/index.js";

test("immutable data reuses only recursively owned copies, never host shallow freezes", () => {
  const nested = { value: 1 };
  const host = Object.freeze({ nested });
  const copy = immutable(host);
  expect(copy).not.toBe(host);
  nested.value = 2;
  expect(copy.nested.value).toBe(1);
  expect(Object.isFrozen(copy.nested)).toBe(true);
  expect(immutable(copy)).toBe(copy);
});

test("immutable copies support cycles without freezing mutable host objects", () => {
  const host: { self?: unknown } = {};
  host.self = host;
  const copy = immutable(host);
  expect(copy.self).toBe(copy);
  expect(Object.isFrozen(copy)).toBe(true);
  expect(Object.isFrozen(host)).toBe(false);
});

test("source relevance fallback and per-item personalization policy reach the engine", async () => {
  const storage = createMemoryRankingStore({ allowPlainQueryKeys: true });
  const flow = createCmdFlow({
    ranking: { store: storage, scope: { subjectKey: "test", surfaceId: "palette" } },
    commands: [
      {
        id: "semantic",
        title: "Pull requests",
        allowFallback: true,
        personalize: false,
        action: {
          type: "run",
          id: "semantic",
          title: "Pull requests",
          run() {},
        },
      },
    ],
  });
  flow.open();
  flow.setQuery("github");
  expect(flow.getSnapshot().mainFrame.items[0]?.id).toBe("semantic");
  await flow.invoke();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const profile = await storage.load({
    scope: { subjectKey: "test", surfaceId: createRankingSurfaceId("palette", "main", "root") },
    now: Date.now(),
  });
  expect(profile.records).toHaveLength(0);
  flow.destroy();
});

test("replacing a dirty form requires confirmation", async () => {
  const flow = createCmdFlow();
  flow.open();
  flow.push({
    id: "form",
    type: "form",
    fields: [{ id: "title", type: "text", label: "Title" }],
    submit: { type: "run", id: "save", title: "Save", run() {} },
  });
  flow.setField("title", "draft");
  flow.replace({ id: "next", type: "detail" });
  expect(flow.getSnapshot().mainFrame.view.id).toBe("form");
  expect(flow.getSnapshot().confirmation?.kind).toBe("discard");
  await flow.confirm();
  expect(flow.getSnapshot().mainFrame.view.id).toBe("next");
  flow.destroy();
});

test("ranking surfaces cannot collide through host or view delimiters", () => {
  expect(createRankingSurfaceId("a", "main", "b:main:c")).not.toBe(
    createRankingSurfaceId("a:main:b", "main", "c"),
  );
});

test("query ranking reuses static result metadata but reevaluates dynamic action predicates", () => {
  let enabled = true;
  const flow = createCmdFlow({
    commands: [
      {
        id: "static",
        title: "GitHub static",
        action: { type: "run", id: "static", title: "GitHub static", run() {} },
      },
      {
        id: "dynamic",
        title: "GitHub dynamic",
        enabled: () => enabled,
        action: { type: "run", id: "dynamic", title: "GitHub dynamic", run() {} },
      },
    ],
  });
  const item = flow.getSnapshot().mainFrame.items.find((entry) => entry.id === "static");
  enabled = false;
  flow.setQuery("github");
  expect(flow.getSnapshot().mainFrame.items.find((entry) => entry.id === "static")).toBe(item);
  expect(flow.getSnapshot().mainFrame.items.find((entry) => entry.id === "dynamic")?.disabled).toBe(
    true,
  );
  flow.destroy();
});

test("edits made during an awaited submit remain dirty after success", async () => {
  let resolve!: () => void;
  const pending = new Promise<void>((done) => {
    resolve = done;
  });
  const flow = createCmdFlow();
  flow.open();
  flow.push({
    id: "form",
    type: "form",
    fields: [{ id: "title", type: "text", label: "Title" }],
    submit: { type: "run", id: "save", title: "Save", run: () => pending },
  });
  flow.setField("title", "before");
  const result = flow.submitForm();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  flow.setField("title", "after");
  resolve();
  await result;
  expect(flow.getSnapshot().mainFrame.form.dirty).toBe(true);
  expect(flow.getSnapshot().mainFrame.form.values.title).toBe("after");
  flow.destroy();
});
