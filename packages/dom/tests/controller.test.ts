import { afterEach, describe, expect, test } from "bun:test";
import { createCmdFlow } from "@cmdflow/core";
import { Window } from "happy-dom";
import { createDomController, describeKeybinding, matchesKeybinding } from "../src/controller.js";
import { getVirtualRange } from "../src/virtual.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function fixture(options: Parameters<typeof createDomController>[1] = {}, managed = true) {
  const window = new Window({ url: "https://cmdflow.test" });
  const document = window.document as unknown as Document;
  let runs = 0;
  const store = createCmdFlow({
    id: "test",
    commands: [
      {
        id: "a",
        title: "Alpha",
        run: () => {
          runs += 1;
        },
        actions: [
          {
            id: "open",
            title: "Open",
            priority: "primary",
            run: () => {
              runs += 1;
            },
          },
          {
            id: "extra",
            title: "Extra",
            run: () => {
              runs += 10;
            },
          },
        ],
      },
      {
        id: "b",
        title: "Beta",
        enabled: () => ({ reason: "Sign in first" }),
        run: () => {
          runs += 100;
        },
      },
      {
        id: "c",
        title: "Charlie",
        run: () => {
          runs += 1_000;
        },
      },
    ],
  });
  const controller = createDomController(store, {
    eventMode: "delegate",
    announcementDelay: 0,
    ...options,
  });
  const opener = document.createElement("button");
  opener.textContent = "Open";
  const dialog = document.createElement(managed ? "div" : "dialog");
  const input = document.createElement("input");
  const list = document.createElement("div");
  const actionsButton = document.createElement("button");
  actionsButton.textContent = "Actions";
  document.body.append(opener, dialog);
  dialog.append(input, list, actionsButton);
  controller.bindDialog(dialog);
  controller.bindInput(input);
  controller.bindList(list);
  let rowDisposers: (() => void)[] = [];
  function render() {
    for (const dispose of rowDisposers) dispose();
    list.replaceChildren();
    rowDisposers = store.getSnapshot().current.items.map((item) => {
      const row = document.createElement("div");
      row.textContent = item.title;
      list.append(row);
      return controller.registerItem(item.candidateId, row);
    });
    controller.sync(store.getSnapshot());
  }
  function key(
    key: string,
    init: Pick<
      KeyboardEventInit,
      "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "repeat" | "isComposing"
    > = {},
    target: HTMLElement = input,
  ) {
    const event = new window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      composed: true,
      ...init,
    });
    target.dispatchEvent(event as unknown as Event);
    return event;
  }
  opener.focus();
  render();
  disposers.push(() => {
    controller.destroy();
    store.destroy();
    window.happyDOM.abort();
  });
  return {
    window,
    document,
    store,
    controller,
    opener,
    dialog,
    input,
    list,
    actionsButton,
    render,
    key,
    runs: () => runs,
  };
}

describe("commit-bound DOM interaction", () => {
  test("opens and focuses only after explicit commit; virtual focus is mounted and scoped", () => {
    const f = fixture();
    f.store.open();
    expect(f.document.activeElement).toBe(f.opener);
    f.render();
    expect(f.document.activeElement).toBe(f.input);
    expect(f.input.getAttribute("role")).toBe("combobox");
    expect(f.list.getAttribute("role")).toBe("listbox");
    expect(f.input.getAttribute("aria-controls")).toBe(f.list.id);
    expect(f.input.getAttribute("aria-activedescendant")).toBe(
      f.list.firstElementChild?.id ?? null,
    );
    expect(f.list.firstElementChild?.hasAttribute("aria-selected")).toBe(false);
    expect(f.opener.inert).toBe(true);
    f.key("ArrowDown");
    f.render();
    expect(f.document.activeElement).toBe(f.input);
    expect(f.input.getAttribute("aria-activedescendant")).toBe(f.list.children[1]?.id ?? null);
    expect(f.list.children[1]?.getAttribute("aria-disabled")).toBe("true");
    expect(f.list.children[1]?.getAttribute("aria-description")).toBe("Sign in first");
  });

  test("uses input events for paste and leaves editing keys untouched", () => {
    const f = fixture();
    f.store.open();
    f.render();
    f.input.value = "char";
    f.input.dispatchEvent(
      new f.window.InputEvent("input", {
        bubbles: true,
        inputType: "insertFromPaste",
      }) as unknown as Event,
    );
    expect(f.store.getSnapshot().current.query).toBe("char");
    expect(f.store.getSnapshot().current.items[0]?.title).toBe("Charlie");
    for (const key of ["Home", "End", "ArrowLeft", "ArrowRight", "Backspace"])
      expect(f.key(key).defaultPrevented).toBe(false);
  });

  test("composition defers navigation, invocation and Escape until committed input", async () => {
    const f = fixture();
    f.store.open();
    f.render();
    f.input.dispatchEvent(
      new f.window.CompositionEvent("compositionstart", { bubbles: true }) as unknown as Event,
    );
    f.input.value = "alpha";
    f.input.dispatchEvent(
      new f.window.InputEvent("input", { bubbles: true, isComposing: true }) as unknown as Event,
    );
    expect(f.store.getSnapshot().current.composing).toBe(true);
    for (const key of ["Enter", "Escape", "ArrowDown"])
      expect(f.key(key).defaultPrevented).toBe(false);
    expect(f.store.getSnapshot().open).toBe(true);
    expect(f.runs()).toBe(0);
    f.input.dispatchEvent(
      new f.window.CompositionEvent("compositionend", { bubbles: true }) as unknown as Event,
    );
    expect(f.store.getSnapshot().current.composing).toBe(false);
    expect(f.store.getSnapshot().current.items).toHaveLength(1);
    f.render();
    f.key("Enter");
    await Promise.resolve();
    expect(f.runs()).toBe(1);
  });

  test("delegated nested markup click runs once; disabled options remain navigable", async () => {
    const f = fixture();
    f.store.open();
    f.render();
    const nested = f.document.createElement("span");
    f.list.firstElementChild?.append(nested);
    nested.click();
    await Promise.resolve();
    expect(f.runs()).toBe(1);
    f.key("ArrowDown");
    f.render();
    f.key("Enter");
    await Promise.resolve();
    expect(f.runs()).toBe(1);
  });

  test("props bindings install no duplicate handlers and consumer prevention wins", async () => {
    const f = fixture({ eventMode: "props" });
    f.store.open();
    f.render();
    const before = f.store.getSnapshot().current.activeId;
    f.key("ArrowDown");
    expect(f.store.getSnapshot().current.activeId).toBe(before);
    const handler = f.controller.getInputProps().onKeyDown;
    f.input.addEventListener("keydown", handler);
    f.dialog.addEventListener("keydown", (event) =>
      f.controller.getDialogProps().onKeyDown(event as KeyboardEvent),
    );
    f.key("ArrowDown");
    expect(
      f.store
        .getSnapshot()
        .current.items.find((item) => item.candidateId === f.store.getSnapshot().current.activeId)
        ?.title,
    ).toBe("Beta");
    const event = new f.window.KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    event.preventDefault();
    handler(event as unknown as KeyboardEvent);
    await Promise.resolve();
    expect(f.runs()).toBe(0);
  });

  test("pointer movement switches modality but stationary events preserve keyboard selection", () => {
    const f = fixture();
    f.store.open();
    f.render();
    const first = f.list.firstElementChild;
    first?.dispatchEvent(
      new f.window.PointerEvent("pointermove", {
        bubbles: true,
        clientX: 4,
        clientY: 8,
        pointerType: "mouse",
      }) as unknown as Event,
    );
    f.key("ArrowDown");
    const active = f.store.getSnapshot().current.activeId;
    first?.dispatchEvent(
      new f.window.PointerEvent("pointermove", {
        bubbles: true,
        clientX: 4,
        clientY: 8,
        pointerType: "mouse",
      }) as unknown as Event,
    );
    expect(f.store.getSnapshot().current.activeId).toBe(active);
  });

  test("restores actions opener and then shell opener", () => {
    const f = fixture();
    f.store.open();
    f.render();
    f.actionsButton.focus();
    f.store.openActions();
    const actionInput = f.document.createElement("input");
    const actionList = f.document.createElement("div");
    f.dialog.append(actionInput, actionList);
    f.controller.bindInput(actionInput, "actions");
    f.controller.bindList(actionList, "actions");
    f.controller.sync();
    expect(f.document.activeElement).toBe(actionInput);
    f.store.closeActions();
    f.controller.sync();
    expect(f.document.activeElement).toBe(f.actionsButton);
    f.store.close();
    f.controller.sync();
    expect(f.document.activeElement).toBe(f.opener);
    expect(f.opener.inert).toBe(false);
  });

  test("restores a valid host fallback when the shell opener was removed", () => {
    let fallback: HTMLElement | null = null;
    const f = fixture({ restoreFocus: () => fallback });
    fallback = f.document.createElement("button");
    f.document.body.append(fallback);
    f.store.open();
    f.render();
    f.opener.remove();
    f.store.close();
    f.controller.sync();
    expect(f.document.activeElement).toBe(fallback);
  });

  test("managed modal cycles real tab stops while options remain virtually focused", () => {
    const f = fixture();
    f.store.open();
    f.render();
    f.actionsButton.focus();
    expect(f.key("Tab", {}, f.actionsButton).defaultPrevented).toBe(true);
    expect(f.document.activeElement).toBe(f.input);
    expect(f.key("Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(f.document.activeElement).toBe(f.actionsButton);
  });

  test("native modal explicitly wraps Tab at its boundary", () => {
    const f = fixture({}, false);
    f.store.open();
    f.render();
    f.actionsButton.focus();
    expect(f.key("Tab", {}, f.actionsButton).defaultPrevented).toBe(true);
    expect(f.document.activeElement).toBe(f.input);
    expect(f.key("Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(f.document.activeElement).toBe(f.actionsButton);
  });

  test("authoritative composition state blocks commands after an input binding was replaced", async () => {
    const f = fixture();
    f.store.open();
    f.render();
    f.store.setQuery("alpha", undefined, true);
    const dispose = f.controller.bindInput(f.input);
    dispose();
    f.controller.bindInput(f.input);
    f.key("Enter");
    f.key("Escape");
    f.key("ArrowDown");
    await Promise.resolve();
    expect(f.runs()).toBe(0);
    expect(f.store.getSnapshot().open).toBe(true);
    expect(f.store.getSnapshot().current.composing).toBe(true);
  });

  test("InputEvent.isComposing protects composition even without a start event", async () => {
    const f = fixture();
    f.store.open();
    f.render();
    f.input.value = "alpha";
    f.input.dispatchEvent(
      new f.window.InputEvent("input", { bubbles: true, isComposing: true }) as unknown as Event,
    );
    expect(f.store.getSnapshot().current.composing).toBe(true);
    f.key("Enter");
    await Promise.resolve();
    expect(f.runs()).toBe(0);
    f.input.dispatchEvent(
      new f.window.CompositionEvent("compositionend", { bubbles: true }) as unknown as Event,
    );
    expect(f.store.getSnapshot().current.composing).toBe(false);
  });

  test("ignores stale committed snapshots and keeps newer focus effects pending", () => {
    const f = fixture();
    const closed = f.store.getSnapshot();
    f.store.open();
    f.controller.sync(closed);
    expect(f.document.activeElement).toBe(f.opener);
    expect(f.store.getDomEffects().some((effect) => effect.type === "focus")).toBe(true);
    f.render();
    f.controller.sync(closed);
    expect(f.document.activeElement).toBe(f.input);
    expect(f.dialog.hidden).toBe(false);
  });

  test("native cancel follows authoritative controlled state", () => {
    const window = new Window();
    const document = window.document as unknown as Document;
    let requests = 0;
    const store = createCmdFlow({
      controlledOpen: true,
      onOpenChange: () => {
        requests += 1;
      },
    });
    const controller = createDomController(store);
    const dialog = document.createElement("dialog");
    document.body.append(dialog);
    controller.bindDialog(dialog);
    store.setOpen(true);
    controller.sync();
    const event = new window.Event("cancel", { cancelable: true });
    dialog.dispatchEvent(event as unknown as Event);
    expect(event.defaultPrevented).toBe(true);
    expect(requests).toBe(1);
    expect(store.getSnapshot().open).toBe(true);
    controller.sync();
    expect(dialog.open).toBe(true);
    store.setOpen(false);
    controller.sync();
    expect(dialog.open).toBe(false);
    controller.destroy();
    store.destroy();
    window.happyDOM.abort();
  });

  test("removing active item immediately removes its dangling ARIA reference", () => {
    const f = fixture();
    f.store.open();
    f.render();
    const item = f.store.getSnapshot().current.items[0];
    if (!item) throw new Error("fixture missing item");
    const row = f.document.createElement("div");
    f.list.append(row);
    const dispose = f.controller.registerItem(item.candidateId, row);
    f.controller.sync();
    expect(f.input.getAttribute("aria-activedescendant")).toBe(row.id);
    dispose();
    row.remove();
    expect(f.input.hasAttribute("aria-activedescendant")).toBe(false);
  });

  test("supports separate realms and ShadowRoot focus while rejecting cross-root ARIA", () => {
    const f = fixture();
    const host = f.document.createElement("div");
    f.document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.append(f.dialog);
    f.store.open();
    f.render();
    expect(shadow.activeElement).toBe(f.input);
    f.document.body.append(f.list);
    f.controller.sync();
    expect(f.input.hasAttribute("aria-activedescendant")).toBe(false);
  });

  test("form validation associates errors and focuses the invalid field", async () => {
    const f = fixture();
    f.store.open();
    f.render();
    f.store.push({
      id: "form",
      type: "form",
      title: "Edit",
      fields: [{ id: "name", label: "Name", required: true }],
      submit: { id: "save", title: "Save", run: () => {} },
    });
    const form = f.document.createElement("form");
    const input = f.document.createElement("input");
    form.append(input);
    f.dialog.append(form);
    f.controller.bindForm(form);
    f.controller.bindField("name", input);
    f.controller.sync();
    await f.store.submitForm();
    f.controller.sync();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(f.controller.getFieldErrorProps("name").id);
    expect(f.document.activeElement).toBe(input);
  });

  test("confirmation owns focus and keyboard routing until dismissed", async () => {
    const f = fixture();
    f.store.registerCommand({
      id: "delete",
      title: "Delete",
      destructive: true,
      priority: "primary",
      run: () => {},
    });
    f.store.open();
    f.render();
    const item = f.store.getSnapshot().current.items.find((item) => item.id === "delete");
    if (!item) throw new Error("fixture missing delete command");
    const confirmation = f.document.createElement("div");
    const cancel = f.document.createElement("button");
    const confirm = f.document.createElement("button");
    confirmation.append(cancel, confirm);
    f.dialog.append(confirmation);
    f.controller.bindConfirmation(confirmation);
    await f.store.invoke({
      candidateId: item.candidateId,
      address: { surface: "main", frameId: f.store.getSnapshot().current.id },
    });
    f.controller.sync();
    expect(f.document.activeElement).toBe(confirmation);
    expect(f.input.inert).toBe(true);
    expect(f.key("Tab", {}, confirmation).defaultPrevented).toBe(true);
    expect(f.document.activeElement).toBe(cancel);
    expect(f.key("k", { ctrlKey: true }, cancel).defaultPrevented).toBe(false);
    expect(f.store.getSnapshot().actionFrame).toBe(null);
    f.key("Escape", {}, cancel);
    f.controller.sync();
    expect(f.store.getSnapshot().confirmation).toBe(null);
    expect(f.input.inert).toBe(false);
    expect(f.document.activeElement).toBe(f.input);
  });

  test("native dialog does not reference an inert body-level result portal", () => {
    const f = fixture({}, false);
    f.store.open();
    f.render();
    f.document.body.append(f.list);
    f.controller.sync();
    expect(f.input.hasAttribute("aria-activedescendant")).toBe(false);
  });
});

describe("standalone interaction utilities", () => {
  test("default controller prefixes avoid duplicate IDs across same-named stores", () => {
    const first = createCmdFlow();
    const second = createCmdFlow();
    const firstController = createDomController(first);
    const secondController = createDomController(second);
    expect(firstController.getInputProps().id).not.toBe(secondController.getInputProps().id);
    firstController.destroy();
    secondController.destroy();
    first.destroy();
    second.destroy();
  });

  test("document shortcut priority selects one instance and cleanup transfers ownership", () => {
    const window = new Window();
    const document = window.document as unknown as Document;
    const first = createCmdFlow();
    const second = createCmdFlow();
    const firstController = createDomController(first, {
      openShortcut: { key: "j", ctrl: true },
      shortcutPriority: 1,
    });
    const secondController = createDomController(second, {
      openShortcut: { key: "j", ctrl: true },
      shortcutPriority: 2,
    });
    const firstDialog = document.createElement("dialog");
    const secondDialog = document.createElement("dialog");
    document.body.append(firstDialog, secondDialog);
    firstController.bindDialog(firstDialog);
    const cleanup = secondController.bindDialog(secondDialog);
    const press = (target: HTMLElement = document.body) =>
      target.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "j",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }) as unknown as Event,
      );
    press();
    expect(first.getSnapshot().open).toBe(false);
    expect(second.getSnapshot().open).toBe(true);
    cleanup();
    press();
    expect(first.getSnapshot().open).toBe(true);
    first.close();
    const input = document.createElement("input");
    document.body.append(input);
    press(input);
    expect(first.getSnapshot().open).toBe(false);
    firstController.destroy();
    secondController.destroy();
    first.destroy();
    second.destroy();
    window.happyDOM.abort();
  });

  test("virtual range always pins the active index in logical order", () => {
    const range = getVirtualRange({
      count: 1_000,
      scrollTop: 0,
      viewportHeight: 100,
      rowHeight: 20,
      overscan: 1,
      activeIndex: 999,
    });
    expect(range.indexes).toEqual([0, 1, 2, 3, 4, 5, 999]);
    expect(range.totalHeight).toBe(20_000);
    expect(range.offsetFor(999)).toBe(19_980);
    expect(
      getVirtualRange({ count: Number.NaN, scrollTop: Infinity, viewportHeight: -1, rowHeight: 0 })
        .totalHeight,
    ).toBe(0);
  });
  test("logical platform shortcuts reject unintended modifiers", () => {
    const window = new Window();
    const event = new window.KeyboardEvent("keydown", { key: "k", metaKey: true });
    expect(
      matchesKeybinding(event as unknown as KeyboardEvent, { key: "k", mod: true }, true),
    ).toBe(true);
    expect(
      matchesKeybinding(event as unknown as KeyboardEvent, { key: "k", mod: true }, false),
    ).toBe(false);
    expect(describeKeybinding({ key: "k", mod: true }, true)).toBe("Meta+K");
    window.happyDOM.abort();
  });
});
