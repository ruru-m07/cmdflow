import { afterEach, describe, expect, test } from "bun:test";
import { createCmdFlow } from "@cmdflow/core";
import {
  type HTMLElement as HappyHTMLElement,
  type HTMLInputElement as HappyHTMLInputElement,
  Window,
} from "happy-dom";
import { act, createElement, createRef, StrictMode } from "react";
import { createRoot, hydrateRoot, type Root as ReactRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { Command, composeRefs, useCmdflowSelector } from "../src/index.js";

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
  IS_REACT_ACT_ENVIRONMENT: true,
});

let mountedRoot: ReactRoot | undefined;
afterEach(async () => {
  if (mountedRoot) await act(() => mountedRoot?.unmount());
  mountedRoot = undefined;
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

function Parts() {
  return (
    <Command.Dialog aria-label="Application commands">
      <Command.Input aria-label="Find a command" />
      <Command.List>{(item) => <Command.Item key={item.candidateId} item={item} />}</Command.List>
      <Command.ActionsTrigger>Actions</Command.ActionsTrigger>
      <Command.Actions>
        <Command.Input aria-label="Find an action" />
        <Command.List>{(item) => <Command.Item key={item.candidateId} item={item} />}</Command.List>
      </Command.Actions>
      <Command.Status />
      <Command.Close>Close</Command.Close>
    </Command.Dialog>
  );
}

async function mount(children: React.ReactNode) {
  const host = browser.document.createElement("main");
  browser.document.body.append(host);
  mountedRoot = createRoot(host as unknown as HTMLElement);
  await act(() => mountedRoot?.render(children));
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

describe("React adapter conformance", () => {
  test("runtime native open and initial input values cannot bypass the store", async () => {
    const flow = flowWithItems();
    const unsafeDialogProps = { open: true };
    const unsafeInputProps = {
      "aria-label": "Owned search",
      value: "forced value",
      defaultValue: "forced default",
    };
    const host = await mount(
      <Command.Root store={flow}>
        <Command.Dialog {...unsafeDialogProps}>
          <Command.Input {...unsafeInputProps} />
          <Command.List>
            {(item) => <Command.Item key={item.candidateId} item={item} />}
          </Command.List>
        </Command.Dialog>
      </Command.Root>,
    );
    expect(host.querySelector("dialog")?.hasAttribute("open")).toBe(false);
    expect(getInput(host).value).toBe("");
    expect(getInput(host).defaultValue).toBe("");
    await act(() => flow.open());
    expect(host.querySelector("dialog")?.hasAttribute("open")).toBe(true);
    await act(() => flow.setQuery("GitHub"));
    expect(getInput(host).value).toBe("GitHub");
    await act(() => flow.close());
    expect(host.querySelector("dialog")?.hasAttribute("open")).toBe(false);
    await act(() => flow.destroy());
  });
  test("composed refs honor React callback cleanup and clear object refs", () => {
    const element = browser.document.createElement("div") as unknown as HTMLDivElement;
    const objectRef = createRef<HTMLDivElement>();
    let cleaned = 0;
    let nullCalls = 0;
    const ref = composeRefs<HTMLDivElement>(objectRef, (value) => {
      if (value === null) {
        nullCalls += 1;
        return;
      }
      return () => {
        cleaned += 1;
      };
    });
    ref(element);
    expect(objectRef.current === element).toBe(true);
    ref(null);
    expect(cleaned).toBe(1);
    expect(nullCalls).toBe(0);
    expect(objectRef.current).toBeNull();
  });
  test("moving the active item does not remap the unchanged result collection", async () => {
    const flow = flowWithItems();
    let rowsRendered = 0;
    await mount(
      <Command.Root store={flow}>
        <Command.Dialog>
          <Command.Input />
          <Command.List>
            {(item) => {
              rowsRendered += 1;
              return <Command.Item key={item.candidateId} item={item} />;
            }}
          </Command.List>
        </Command.Dialog>
      </Command.Root>,
    );
    await act(() => flow.open());
    const previous = rowsRendered;
    await act(() => flow.moveActive("next"));
    expect(rowsRendered).toBe(previous);
    await act(() => flow.destroy());
  });
  test("hydration preserves server markup and then adopts the current client snapshot", async () => {
    const flow = flowWithItems();
    const content = (
      <Command.Root store={flow}>
        <Parts />
      </Command.Root>
    );
    const host = browser.document.createElement("main");
    host.innerHTML = renderToString(content);
    browser.document.body.append(host);
    flow.setQuery("Linear");
    const errors: unknown[] = [];
    await act(() => {
      mountedRoot = hydrateRoot(host as unknown as HTMLElement, content, {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    expect(errors).toEqual([]);
    expect(getInput(host, 'input[aria-label="Find a command"]').value).toBe("Linear");
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
    await act(() => flow.destroy());
  });

  test("native form controls validate through core and associate errors with their fields", async () => {
    let submitted = "";
    const flow = createCmdFlow({
      root: {
        id: "create",
        type: "form",
        title: "Create pull request",
        fields: [
          { id: "title", label: "Title", required: true },
          { id: "body", label: "Description", type: "textarea" },
          {
            id: "base",
            label: "Base",
            type: "select",
            defaultValue: "main",
            options: [{ value: "main", label: "main" }],
          },
        ],
        submit: {
          id: "submit",
          title: "Create",
          run: ({ values }) => {
            submitted = String(values.title);
          },
        },
      },
    });
    const host = await mount(
      <Command.Root store={flow}>
        <Command.Dialog>
          <Command.Form>
            <Command.FieldLabel fieldId="title" />
            <Command.Field fieldId="title" />
            <Command.FieldError fieldId="title" />
            <Command.Textarea fieldId="body" />
            <Command.Select fieldId="base" />
            <button type="submit">Create</button>
          </Command.Form>
          <Command.Status />
        </Command.Dialog>
      </Command.Root>,
    );
    await act(() => flow.open());
    const input = getInput(host, 'input[name="title"]');
    await act(async () => {
      host
        .querySelector("form")
        ?.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    expect(input?.getAttribute("aria-describedby")).toBe(
      getId(host, '[data-cmdflow-part="field-error"]'),
    );
    expect(browser.document.activeElement === input).toBe(true);
    await act(() => {
      if (input) input.value = "Ship CmdFlow";
      input?.dispatchEvent(new browser.Event("input", { bubbles: true }));
    });
    await act(async () => {
      host
        .querySelector("form")
        ?.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(submitted).toBe("Ship CmdFlow");
    expect(host.querySelector("select")?.value).toBe("main");
    await act(() => flow.destroy());
  });

  test("server rendering uses the cached server snapshot and unique per-root DOM IDs", () => {
    const flow = flowWithItems();
    const initial = flow.getServerSnapshot();
    flow.setQuery("Linear");
    expect(flow.getServerSnapshot()).toBe(initial);
    const html = renderToString(
      <>
        <Command.Root store={flow}>
          <Parts />
        </Command.Root>
        <Command.Root store={flow}>
          <Parts />
        </Command.Root>
      </>,
    );
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-label="Application commands"');
    expect(html).toContain("GitHub Issues");
    expect(html).not.toContain('value="Linear"');
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    flow.destroy();
  });

  test("focus, virtual active item, consumer cancellation, and invocation share the core", async () => {
    let invocations = 0;
    let cancelNavigation = false;
    const flow = flowWithItems(() => {
      invocations += 1;
    });
    const inputRef = createRef<HTMLInputElement>();
    const host = await mount(
      <Command.Root store={flow}>
        <Command.Dialog aria-label="Custom title">
          <Command.Input
            ref={inputRef}
            aria-label="Custom search"
            onKeyDown={(event) => {
              if (cancelNavigation && event.key === "ArrowDown") event.preventDefault();
            }}
          />
          <Command.List>
            {(item) => <Command.Item key={item.candidateId} item={item} />}
          </Command.List>
          <Command.Close />
        </Command.Dialog>
      </Command.Root>,
    );
    await act(() => flow.open());
    const input = getInput(host);
    // React's DOM ref and Happy DOM's node are the same object across their distinct type models.
    expect<object | null>(inputRef.current).toBe(input);
    expect(browser.document.activeElement === input).toBe(true);
    expect(host.querySelector("dialog")?.getAttribute("aria-label")).toBe("Custom title");
    expect(input?.getAttribute("aria-label")).toBe("Custom search");
    await act(() => {
      input?.dispatchEvent(
        new browser.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
    });
    const active = flow.getSnapshot().current.activeId;
    expect(active).toBe(flow.getSnapshot().current.items[1]?.candidateId ?? null);
    expect(input?.getAttribute("aria-activedescendant")).toBe(
      getId(host, '[data-state="active"][role="option"]'),
    );
    cancelNavigation = true;
    await act(() => {
      input?.dispatchEvent(
        new browser.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
    });
    expect(flow.getSnapshot().current.activeId).toBe(active);
    await act(async () => {
      input?.dispatchEvent(
        new browser.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(invocations).toBe(1);
    expect(host.querySelector('[role="option"]')?.hasAttribute("aria-selected")).toBe(false);
    await act(() => flow.destroy());
  });

  test("the actions surface has independent search and restores its trigger", async () => {
    const flow = flowWithItems();
    const host = await mount(
      <Command.Root store={flow}>
        <Parts />
      </Command.Root>,
    );
    await act(() => {
      flow.open();
      flow.setQuery("GitHub");
    });
    const trigger = host.querySelector('[data-cmdflow-part="actions-trigger"]');
    await act(() => {
      trigger?.dispatchEvent(new browser.MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    const actionInput = getInput(host, 'input[aria-label="Find an action"]');
    expect(flow.getSnapshot().actionFrame).not.toBeNull();
    expect(browser.document.activeElement === actionInput).toBe(true);
    await act(() => {
      if (actionInput) actionInput.value = "Copy";
      actionInput?.dispatchEvent(new browser.Event("input", { bubbles: true }));
    });
    expect(flow.getSnapshot().actionFrame?.query).toBe("Copy");
    expect(flow.getSnapshot().current.query).toBe("GitHub");
    await act(() => flow.closeActions());
    expect(browser.document.activeElement === trigger).toBe(true);
    expect(flow.getSnapshot().current.query).toBe("GitHub");
    await act(() => flow.destroy());
  });

  test("IME input updates the visible query without handling navigation keys", async () => {
    const flow = flowWithItems();
    const host = await mount(
      <Command.Root store={flow}>
        <Parts />
      </Command.Root>,
    );
    await act(() => flow.open());
    const input = getInput(host, 'input[aria-label="Find a command"]');
    const originalActive = flow.getSnapshot().current.activeId;
    await act(() => {
      input?.dispatchEvent(new browser.CompositionEvent("compositionstart", { bubbles: true }));
      if (input) input.value = "Git";
      input?.dispatchEvent(new browser.Event("input", { bubbles: true }));
      input?.dispatchEvent(
        new browser.KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          isComposing: true,
        }),
      );
    });
    expect(flow.getSnapshot().current.query).toBe("Git");
    expect(flow.getSnapshot().current.activeId).toBe(originalActive);
    await act(() => {
      input?.dispatchEvent(new browser.CompositionEvent("compositionend", { bubbles: true }));
    });
    expect(flow.getSnapshot().current.composing).toBe(false);
    await act(() => flow.destroy());
  });

  test("selected subscriptions skip unrelated transitions and StrictMode releases all bindings", async () => {
    const flow = flowWithItems();
    let subscriptionCount = 0;
    const subscribe = flow.subscribe;
    flow.subscribe = (listener) => {
      subscriptionCount += 1;
      const unsubscribe = subscribe(listener);
      return () => {
        subscriptionCount -= 1;
        unsubscribe();
      };
    };
    let renders = 0;
    function OpenState() {
      const selection = useCmdflowSelector(
        (snapshot) => ({ open: snapshot.open }),
        undefined,
        (left, right) => left.open === right.open,
      );
      renders += 1;
      return createElement("span", null, String(selection.open));
    }
    await mount(
      <StrictMode>
        <Command.Root store={flow}>
          <Parts />
          <OpenState />
        </Command.Root>
      </StrictMode>,
    );
    const before = renders;
    await act(() => flow.setQuery("GitHub"));
    expect(renders).toBe(before);
    expect(subscriptionCount).toBeGreaterThan(0);
    await act(() => mountedRoot?.unmount());
    mountedRoot = undefined;
    expect(subscriptionCount).toBe(0);
    expect(flow.getSnapshot().destroyed).toBe(false);
    flow.setQuery("Linear");
    expect(flow.getSnapshot().current.items[0]?.title).toBe("Linear");
    flow.destroy();
  });
});
