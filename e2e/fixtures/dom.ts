import {
  type CmdFlowSnapshot,
  createCmdFlow,
  type FrameSnapshot,
  type SurfaceAddress,
} from "../../packages/core/dist/index.js";
import { createDomController } from "../../packages/dom/dist/index.js";

interface FixtureApi {
  snapshot(): CmdFlowSnapshot;
  runs(): readonly string[];
  closeRequests(): number;
  acceptClose(): void;
  destroy(): void;
  cancelNative(): boolean;
}

declare global {
  interface Window {
    cmdflowFixture: FixtureApi;
  }
}

const params = new URLSearchParams(location.search);
const controlled = params.get("controlled") === "true";
const mode = params.get("scope") ?? "document";
let owner = document;
let container: HTMLElement | ShadowRoot = document.body;
if (mode === "shadow") {
  const host = document.createElement("section");
  host.id = "shadow-host";
  document.body.append(host);
  container = host.attachShadow({ mode: "open" });
} else if (mode === "iframe") {
  const frame = document.createElement("iframe");
  frame.title = "CmdFlow isolated document";
  frame.srcdoc =
    '<!doctype html><html lang="en"><head><title>CmdFlow frame</title></head><body></body></html>';
  const loaded = new Promise<void>((resolve) =>
    frame.addEventListener("load", () => resolve(), { once: true }),
  );
  document.body.append(frame);
  await loaded;
  if (!frame.contentDocument) throw new Error("Fixture iframe has no document");
  owner = frame.contentDocument;
  container = owner.body;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const result = owner.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}

const openButton = element("button", "Open commands");
const outsideInput = element("input");
outsideInput.setAttribute("aria-label", "Outside input");
const dialog = element("dialog");
const main = element("section");
const mainInput = element("input");
const mainList = element("div");
const actions = element("section");
actions.setAttribute("role", "dialog");
actions.setAttribute("aria-label", "Contextual actions");
const actionsInput = element("input");
const actionsList = element("div");
const actionBack = element("button", "Back to actions");
const actionClose = element("button", "Close actions");
const trigger = element("button", "Actions");
const close = element("button", "Close");
const confirmation = element("section");
const confirmationTitle = element("p");
const confirm = element("button", "Confirm");
const cancel = element("button", "Cancel");
const output = element("output");
output.id = "executions";
main.append(mainInput, mainList);
actions.append(actionsInput, actionsList, actionBack, actionClose);
confirmation.append(confirmationTitle, cancel, confirm);
dialog.append(main, trigger, close, actions, confirmation);
container.append(openButton, outsideInput, dialog, output);

const runs: string[] = [];
let canClose = false;
let closeRequests = 0;
const store = createCmdFlow({
  id: `native-${mode}`,
  controlledOpen: controlled,
  onOpenChange(open) {
    if (!open) closeRequests += 1;
    if (controlled && (open || canClose)) store.setOpen(open);
  },
  commands: [
    {
      id: "alpha",
      title: "Alpha",
      actions: [
        {
          id: "open-alpha",
          title: "Open Alpha",
          priority: "primary",
          run: () => {
            runs.push("alpha");
          },
        },
        {
          id: "more",
          title: "More actions",
          children: [
            {
              id: "nested",
              title: "Nested action",
              run: () => {
                runs.push("nested");
              },
            },
          ],
        },
        {
          id: "delete",
          title: "Delete Alpha",
          destructive: true,
          run: () => {
            runs.push("delete");
          },
        },
      ],
    },
    {
      id: "beta",
      title: "Beta",
      disabled: { reason: "Connect your account" },
      run: () => {
        runs.push("beta");
      },
    },
    {
      id: "gamma",
      title: "Gamma",
      run: () => {
        runs.push("gamma");
      },
    },
  ],
});
const controller = createDomController(store, {
  id: `native-${mode}-dom`,
  eventMode: "delegate",
  label: "Native command palette",
  restoreFocus: () => openButton,
  announcementDelay: 0,
  openShortcut: { key: "j", ctrl: true },
});
controller.bindDialog(dialog);
controller.bindConfirmation(confirmation);
let bindings: (() => void)[] = [];
const surfaceBindings = new Map<string, { frameId: string; cleanup: () => void }>();

function attributes(node: HTMLElement, props: object) {
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("on") || key === "style") continue;
    const name = key === "tabIndex" ? "tabindex" : key;
    if (value === undefined || value === null) node.removeAttribute(name);
    else node.setAttribute(name, String(value));
  }
}

function renderSurface(frame: FrameSnapshot, input: HTMLInputElement, list: HTMLElement) {
  const address: SurfaceAddress = { surface: frame.surface, frameId: frame.id };
  const previous = surfaceBindings.get(frame.surface);
  if (previous?.frameId !== frame.id) {
    previous?.cleanup();
    const unbindInput = controller.bindInput(input, address);
    const unbindList = controller.bindList(list, address);
    surfaceBindings.set(frame.surface, {
      frameId: frame.id,
      cleanup: () => {
        unbindInput();
        unbindList();
      },
    });
  }
  list.replaceChildren();
  for (const item of frame.items) {
    const row = element("div");
    const title = element("span", item.title);
    row.append(title);
    if (item.disabledReason) row.append(element("span", ` — ${item.disabledReason}`));
    list.append(row);
    bindings.push(controller.registerItem(item.candidateId, row, address));
  }
}

function render() {
  for (const cleanup of bindings) cleanup();
  bindings = [];
  const snapshot = store.getSnapshot();
  renderSurface(snapshot.current, mainInput, mainList);
  actions.hidden = snapshot.actionFrame === null;
  if (snapshot.actionFrame) renderSurface(snapshot.actionFrame, actionsInput, actionsList);
  else {
    surfaceBindings.get("actions")?.cleanup();
    surfaceBindings.delete("actions");
  }
  confirmation.hidden = snapshot.confirmation === null;
  confirmationTitle.textContent = snapshot.confirmation?.title ?? "";
  attributes(trigger, controller.getActionsTriggerProps(snapshot));
  attributes(close, controller.getCloseProps(snapshot));
  attributes(confirmation, controller.getConfirmationProps(snapshot));
  actionBack.hidden = snapshot.actions.length < 2;
  controller.sync(snapshot);
  output.textContent = runs.join(",");
}

const unsub = store.subscribe(render);
render();
openButton.addEventListener("click", () => store.open());
trigger.addEventListener("click", (event) => controller.getActionsTriggerProps().onClick(event));
close.addEventListener("click", (event) => controller.getCloseProps().onClick(event));
actionBack.addEventListener("click", () => store.pop("actions"));
actionClose.addEventListener("click", () => store.closeActions());
confirm.addEventListener("click", () => {
  void store.confirm();
});
cancel.addEventListener("click", () => store.cancelConfirmation());

window.cmdflowFixture = {
  snapshot: store.getSnapshot,
  runs: () => runs,
  closeRequests: () => closeRequests,
  acceptClose() {
    canClose = true;
  },
  destroy() {
    unsub();
    controller.destroy();
    store.destroy();
  },
  cancelNative() {
    const EventConstructor = owner.defaultView?.Event;
    if (!EventConstructor) throw new Error("Fixture has no event constructor");
    const event = new EventConstructor("cancel", { cancelable: true });
    dialog.dispatchEvent(event);
    return event.defaultPrevented;
  },
};
document.documentElement.dataset.ready = "true";
