import { afterEach, describe, expect, test } from "bun:test";
import { type CmdFlow, createCmdFlow } from "@cmdflow/core";
import {
  type HTMLElement as HappyHTMLElement,
  type HTMLInputElement as HappyHTMLInputElement,
  Window,
} from "happy-dom";
import { createComponent, createEffect } from "solid-js";
import { render } from "solid-js/web";
import { type CmdflowBinding, Command, createCmdflowSelector, useCmdflow } from "../src/index.js";

const browser = new Window({ url: "https://cmdflow.test" });
Object.assign(globalThis, {
  window: browser,
  document: browser.document,
  navigator: browser.navigator,
  HTMLElement: browser.HTMLElement,
  HTMLInputElement: browser.HTMLInputElement,
  HTMLDialogElement: browser.HTMLDialogElement,
  HTMLFormElement: browser.HTMLFormElement,
  HTMLTextAreaElement: browser.HTMLTextAreaElement,
  HTMLSelectElement: browser.HTMLSelectElement,
  Event: browser.Event,
  KeyboardEvent: browser.KeyboardEvent,
  MouseEvent: browser.MouseEvent,
});

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  browser.document.body.innerHTML = "";
});

function flowWithItems(onRun = () => {}) {
  return createCmdFlow({
    commands: [
      {
        id: "github",
        title: "GitHub",
        run: onRun,
        actions: [{ id: "copy", title: "Copy GitHub URL", run: onRun }],
      },
      { id: "issues", title: "GitHub Issues", run: onRun },
      { id: "linear", title: "Linear", run: onRun },
    ],
  });
}

function parts() {
  return createComponent(Command.Dialog, {
    "aria-label": "Application commands",
    get children() {
      return [
        createComponent(Command.Input, { "aria-label": "Find a command" }),
        createComponent(Command.List, {
          children: (item) => createComponent(Command.Item, { item }),
        }),
        createComponent(Command.ActionsTrigger, { children: "Actions" }),
        createComponent(Command.Actions, {
          get children() {
            return [
              createComponent(Command.Input, { "aria-label": "Find an action" }),
              createComponent(Command.List, {
                children: (item) => createComponent(Command.Item, { item }),
              }),
            ];
          },
        }),
        createComponent(Command.Status, {}),
        createComponent(Command.Close, { children: "Close" }),
      ];
    },
  });
}

function mount<T>(flow: CmdFlow<T>, children = parts) {
  const host = browser.document.createElement("main");
  browser.document.body.append(host);
  dispose = render(
    () =>
      createComponent(Command.Root, {
        store: flow,
        get children() {
          return children();
        },
      }),
    host as unknown as HTMLElement,
  );
  return host;
}

function getInput(host: HappyHTMLElement, selector = "input"): HappyHTMLInputElement {
  const input = host.querySelector<HappyHTMLInputElement>(selector);
  if (!input) throw new Error(`Expected an input matching ${selector}.`);
  return input;
}

function getId(host: HappyHTMLElement, selector: string): string {
  const element = host.querySelector(selector);
  if (!element?.id) throw new Error(`Expected an ID on ${selector}.`);
  return element.id;
}

describe("Solid adapter conformance", () => {
  test("runtime native open and initial input values cannot bypass the store", () => {
    const flow = flowWithItems();
    const unsafeDialogProps = { open: true };
    const unsafeInputProps = {
      "aria-label": "Owned search",
      value: "forced value",
      defaultValue: "forced default",
    };
    const host = mount(flow, () =>
      createComponent(Command.Dialog, {
        ...unsafeDialogProps,
        get children() {
          return [
            createComponent(Command.Input, unsafeInputProps),
            createComponent(Command.List, {
              children: (item) => createComponent(Command.Item, { item }),
            }),
          ];
        },
      }),
    );
    expect(host.querySelector("dialog")?.hasAttribute("open")).toBe(false);
    expect(getInput(host).value).toBe("");
    expect(getInput(host).defaultValue).toBe("");
    flow.open();
    expect(host.querySelector("dialog")?.hasAttribute("open")).toBe(true);
    flow.setQuery("GitHub");
    expect(getInput(host).value).toBe("GitHub");
    flow.close();
    expect(host.querySelector("dialog")?.hasAttribute("open")).toBe(false);
    flow.destroy();
  });
  test("keyed item values preserve normal object enumeration", () => {
    const flow = flowWithItems();
    const titles: string[] = [];
    mount(flow, () =>
      createComponent(Command.Dialog, {
        get children() {
          return createComponent(Command.List, {
            children: (item, index) => {
              const copy = { ...item };
              titles.push(copy.title);
              expect(typeof index).toBe("function");
              return createComponent(Command.Item, { item });
            },
          });
        },
      }),
    );
    expect(titles).toEqual(["GitHub", "GitHub Issues", "Linear"]);
    flow.destroy();
  });
  test("the shared core drives reactive attributes, keyboard behavior, and one invocation", async () => {
    let invocations = 0;
    const flow = flowWithItems(() => {
      invocations += 1;
    });
    const host = mount(flow);
    flow.open();
    const input = getInput(host, 'input[aria-label="Find a command"]');
    expect(input).not.toBeNull();
    expect(browser.document.activeElement).toBe(input);
    expect(host.querySelector("dialog")?.getAttribute("aria-label")).toBe("Application commands");
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(3);
    const firstRow = host.querySelector('[role="option"]');
    input?.dispatchEvent(
      new browser.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    expect(flow.getSnapshot().current.activeId).toBe(
      flow.getSnapshot().current.items[1]?.candidateId ?? null,
    );
    expect(input?.getAttribute("aria-activedescendant")).toBe(
      getId(host, '[role="option"][data-state="active"]'),
    );
    expect(host.querySelector('[role="option"]')).toBe(firstRow);
    input?.dispatchEvent(
      new browser.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
    expect(invocations).toBe(1);
    expect(firstRow?.hasAttribute("aria-selected")).toBe(false);
    flow.destroy();
  });

  test("actions search stays independent and reused input bindings follow navigation frames", () => {
    const flow = flowWithItems();
    const host = mount(flow);
    flow.open();
    flow.setQuery("GitHub");
    const mainInput = getInput(host, 'input[aria-label="Find a command"]');
    flow.openActions();
    const actionInput = getInput(host, 'input[aria-label="Find an action"]');
    expect(browser.document.activeElement).toBe(actionInput);
    if (actionInput) actionInput.value = "Copy";
    actionInput?.dispatchEvent(new browser.Event("input", { bubbles: true }));
    expect(flow.getSnapshot().actionFrame?.query).toBe("Copy");
    expect(flow.getSnapshot().current.query).toBe("GitHub");
    flow.closeActions();
    expect(browser.document.activeElement).toBe(mainInput);
    flow.push({
      id: "nested",
      type: "list",
      title: "Nested",
      items: [{ id: "nested-command", title: "Nested command" }],
    });
    expect(browser.document.activeElement).toBe(mainInput);
    if (mainInput) mainInput.value = "Nested";
    mainInput?.dispatchEvent(new browser.Event("input", { bubbles: true }));
    expect(flow.getSnapshot().current.query).toBe("Nested");
    expect(mainInput?.getAttribute("aria-controls")).toBe(getId(host, '[role="listbox"]'));
    flow.pop("main");
    expect(mainInput?.value).toBe("GitHub");
    flow.destroy();
  });

  test("consumer handlers can cancel internal keyboard actions", () => {
    const flow = flowWithItems();
    const host = mount(flow, () =>
      createComponent(Command.Dialog, {
        get children() {
          return [
            createComponent(Command.Input, { onKeyDown: (event) => event.preventDefault() }),
            createComponent(Command.List, {
              children: (item) => createComponent(Command.Item, { item }),
            }),
          ];
        },
      }),
    );
    flow.open();
    const initial = flow.getSnapshot().current.activeId;
    host
      .querySelector("input")
      ?.dispatchEvent(
        new browser.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
    expect(flow.getSnapshot().current.activeId).toBe(initial);
    flow.destroy();
  });

  test("selectors suppress unrelated work, and disposal unsubscribes without owning the store", () => {
    const flow = flowWithItems();
    let subscriberCount = 0;
    const subscribe = flow.subscribe;
    flow.subscribe = (listener) => {
      subscriberCount += 1;
      const unsubscribe = subscribe(listener);
      return () => {
        subscriberCount -= 1;
        unsubscribe();
      };
    };
    let changes = 0;
    let binding: CmdflowBinding | undefined;
    mount(flow, () => {
      binding = useCmdflow();
      const selection = createCmdflowSelector(
        (snapshot) => ({ open: snapshot.open }),
        binding,
        (left, right) => left.open === right.open,
      );
      createEffect(() => {
        selection();
        changes += 1;
      });
      return parts();
    });
    const previous = changes;
    flow.setQuery("GitHub");
    expect(changes).toBe(previous);
    flow.open();
    expect(changes).toBe(previous + 1);
    expect(subscriberCount).toBe(1);
    expect(binding?.snapshot()).toBe(flow.getSnapshot());
    dispose?.();
    dispose = undefined;
    expect(subscriberCount).toBe(0);
    expect(flow.getSnapshot().destroyed).toBe(false);
    flow.destroy();
  });
});
