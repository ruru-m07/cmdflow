import { describe, expect, test } from "bun:test";
import { createCmdFlow } from "../src/index.js";

describe("narrow interaction commits", () => {
  test("navigation preserves result, payload, selection and ranking references", () => {
    const store = createCmdFlow({
      commands: Array.from({ length: 100 }, (_, index) => ({
        id: String(index),
        title: `Command ${index}`,
        data: { value: index },
        run: () => {},
      })),
    });
    const before = store.getSnapshot();
    const ranking = store.explainRanking();
    store.moveActive("next");
    const after = store.getSnapshot();
    expect(after.revision).toBeGreaterThan(before.revision);
    expect(after.current.activeId).not.toBe(before.current.activeId);
    expect(after.current.items).toBe(before.current.items);
    expect(after.current.items[0]?.data).toBe(before.current.items[0]?.data);
    expect(after.current.selectedIds).toBe(before.current.selectedIds);
    expect(store.explainRanking()).toBe(ranking);
    const activeItem = after.current.items.find(
      (item) => item.candidateId === after.current.activeId,
    );
    if (!activeItem) throw new Error("fixture missing active item");
    expect(after.current.actions).toBe(activeItem.actions);
    const stable = store.getSnapshot();
    if (!stable.current.activeId) throw new Error("fixture missing active item");
    store.setActive(stable.current.activeId);
    expect(store.getSnapshot()).toBe(stable);
    store.destroy();
  });

  test("action predicates see the new active identity and preserve unchanged rows", () => {
    const store = createCmdFlow({
      commands: [
        {
          id: "a",
          title: "A",
          actions: [
            {
              id: "context",
              title: "Context",
              enabled: ({ frame, item }) => frame.activeId === item?.candidateId,
              run: () => {},
            },
          ],
        },
        {
          id: "b",
          title: "B",
          actions: [
            {
              id: "context",
              title: "Context",
              enabled: ({ frame, item }) => frame.activeId === item?.candidateId,
              run: () => {},
            },
          ],
        },
        { id: "c", title: "C", run: () => {} },
      ],
    });
    const before = store.getSnapshot();
    const ranking = store.explainRanking();
    store.moveActive("next");
    const after = store.getSnapshot();
    expect(after.current.items[0]?.actions[0]?.disabled).toBe(true);
    expect(after.current.items[1]?.actions[0]?.disabled).toBe(false);
    expect(after.current.actions[0]?.disabled).toBe(false);
    expect(after.current.items[2]).toBe(before.current.items[2]);
    expect(store.explainRanking()).toBe(ranking);
    store.destroy();
  });

  test("committed selection updates bulk-action predicates without reranking", () => {
    const store = createCmdFlow({
      root: { id: "root", type: "list", selectionMode: "multiple" },
      commands: [
        {
          id: "a",
          title: "A",
          actions: [
            {
              id: "bulk",
              title: "Bulk",
              enabled: ({ selection, frame }) =>
                selection.length === 1 && frame.selectedIds.length === 1,
              run: () => {},
            },
          ],
        },
        { id: "b", title: "B", run: () => {} },
      ],
    });
    const before = store.getSnapshot();
    const ranking = store.explainRanking();
    const selected = before.current.items[1]?.candidateId;
    if (!selected) throw new Error("fixture missing selected item");
    store.toggleSelected(selected);
    const after = store.getSnapshot();
    expect(after.current.selectedIds).toEqual([selected]);
    expect(after.current.actions[0]?.disabled).toBe(false);
    expect(after.current.items[1]).toBe(before.current.items[1]);
    expect(store.explainRanking()).toBe(ranking);
    store.toggleSelected(selected);
    expect(store.getSnapshot().current.actions[0]?.disabled).toBe(true);
    store.destroy();
  });

  test("scroll commits do not run command predicates and identical anchors are no-ops", () => {
    let evaluations = 0;
    const store = createCmdFlow({
      commands: [
        {
          id: "a",
          title: "A",
          visible: () => {
            evaluations += 1;
            return true;
          },
          run: () => {},
        },
      ],
    });
    const before = store.getSnapshot();
    const ranking = store.explainRanking();
    const active = before.current.activeId;
    if (!active) throw new Error("fixture missing active item");
    const count = evaluations;
    store.setScrollAnchor({ candidateId: active, offset: -20 });
    const after = store.getSnapshot();
    expect(evaluations).toBe(count);
    expect(after.current.items).toBe(before.current.items);
    expect(after.current.scrollAnchor).toEqual({ candidateId: active, offset: -20 });
    expect(store.explainRanking()).toBe(ranking);
    store.setScrollAnchor({ candidateId: active, offset: -20 });
    expect(store.getSnapshot()).toBe(after);
    store.setScrollAnchor({ candidateId: active, offset: Number.NaN });
    expect(store.getSnapshot()).toBe(after);
    store.destroy();
  });
});
