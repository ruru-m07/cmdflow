import {
  type CmdFlowResolvedItem,
  type CmdFlowSnapshot,
  type CmdFlowViewDefinition,
  createCmdFlow,
} from "../../packages/core/dist/index.js";
import { Command, createCommandFrame } from "../../packages/solid/dist/index.js";
import { createComponent, createMemo, render } from "../../packages/solid/test/browser-runtime.js";

interface SolidFixtureApi {
  snapshot(): CmdFlowSnapshot;
  runs(): readonly string[];
  subscriptions(): number;
  disposeView(): void;
  destroy(): void;
}
declare global {
  interface Window {
    cmdflowSolidFixture: SolidFixtureApi;
  }
}

const runs: string[] = [];
const form: CmdFlowViewDefinition = {
  id: "report",
  type: "form",
  title: "Create report",
  fields: [
    {
      id: "title",
      label: "Report title",
      type: "text",
      required: true,
      validate: (value) =>
        String(value).trim().length < 4 ? "Use at least four characters." : undefined,
    },
    { id: "body", label: "Report description", type: "textarea" },
    {
      id: "branch",
      label: "Report branch",
      type: "select",
      defaultValue: "main",
      options: [
        { value: "main", label: "main" },
        { value: "develop", label: "develop" },
      ],
    },
  ],
  submit: {
    type: "run",
    id: "submit-report",
    title: "Save report",
    run: ({ values }) => {
      runs.push(`report:${values.title}:${values.branch}`);
      return { type: "pop-view", target: "main" };
    },
  },
};
const flow = createCmdFlow<unknown>({
  id: "solid-browser",
  commands: [
    {
      id: "alpha",
      title: "Alpha",
      action: {
        type: "run",
        id: "open-alpha",
        title: "Open Alpha",
        run: () => {
          runs.push("alpha");
        },
      },
      actions: [
        {
          type: "submenu",
          id: "more",
          title: "More actions",
          actions: [
            {
              type: "run",
              id: "nested",
              title: "Nested action",
              run: () => {
                runs.push("nested");
              },
            },
          ],
        },
        {
          type: "run",
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
      action: {
        type: "run",
        id: "open-beta",
        title: "Open Beta",
        run: () => {
          runs.push("beta");
        },
      },
    },
    {
      id: "gamma",
      title: "Gamma",
      action: {
        type: "run",
        id: "open-gamma",
        title: "Open Gamma",
        run: () => {
          runs.push("gamma");
        },
      },
    },
    {
      id: "report",
      title: "Create report",
      action: {
        type: "view",
        id: "create-report",
        title: "Create report",
        target: "main",
        view: form,
      },
    },
  ],
});
let subscriptions = 0;
const subscribe = flow.subscribe;
flow.subscribe = (listener) => {
  subscriptions += 1;
  const unsubscribe = subscribe(listener);
  return () => {
    subscriptions -= 1;
    unsubscribe();
  };
};

function FormView() {
  return createComponent(Command.Form, {
    get children() {
      return [
        createComponent(Command.FieldLabel, { fieldId: "title" }),
        createComponent(Command.Field, { fieldId: "title" }),
        createComponent(Command.FieldError, { fieldId: "title" }),
        createComponent(Command.FieldLabel, { fieldId: "body" }),
        createComponent(Command.Textarea, { fieldId: "body" }),
        createComponent(Command.FieldLabel, { fieldId: "branch" }),
        createComponent(Command.Select, { fieldId: "branch" }),
        createComponent(Command.Back, { "aria-label": "Cancel report", children: "Cancel report" }),
        submitButton(),
      ];
    },
  });
}
function submitButton() {
  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Save report";
  return button;
}
function MainList() {
  return [
    createComponent(Command.Input, { "aria-label": "Search Solid commands" }),
    createComponent(Command.List, {
      children: (item: CmdFlowResolvedItem) => createComponent(Command.Item, { item }),
    }),
  ];
}
function Palette() {
  const frame = createCommandFrame();
  const isForm = createMemo(() => frame()?.view.type === "form");
  const content = createMemo(() =>
    isForm() ? createComponent(FormView, {}) : createComponent(MainList, {}),
  );
  return createComponent(Command.Dialog, {
    "aria-label": "Solid command palette",
    get children() {
      return [
        content(),
        createComponent(Command.ActionPanelTrigger, { children: "Actions" }),
        createComponent(Command.Close, {
          "aria-label": "Close Solid palette",
          children: "Close Solid palette",
        }),
        createComponent(Command.ActionPanel, {
          "aria-label": "Solid contextual actions",
          get children() {
            return [
              createComponent(Command.Input, { "aria-label": "Search Solid actions" }),
              createComponent(Command.List, {
                children: (item: CmdFlowResolvedItem) => createComponent(Command.Item, { item }),
              }),
              createComponent(Command.Back, {
                "aria-label": "Back to actions",
                children: "Back to actions",
              }),
            ];
          },
        }),
        createComponent(Command.Confirmation, {
          get children() {
            return [
              createComponent(Command.CancelConfirmation, { children: "Keep editing" }),
              createComponent(Command.Confirm, { children: "Confirm" }),
            ];
          },
        }),
        createComponent(Command.Status, {}),
      ];
    },
  });
}
const host = document.createElement("section");
host.id = "solid-fixture";
document.body.append(host);
const unmount = render(
  () =>
    createComponent(Command.Root, {
      flow,
      domOptions: {
        id: "solid-browser-dom",
        openShortcut: { key: "j", ctrl: true },
        announcementDelay: 0,
      },
      get children() {
        return [
          createComponent(Command.Trigger, { children: "Open Solid commands" }),
          createComponent(Palette, {}),
        ];
      },
    }),
  host,
);
let disposed = false;
function disposeView() {
  if (!disposed) {
    disposed = true;
    unmount();
  }
}
window.cmdflowSolidFixture = {
  snapshot: flow.getSnapshot,
  runs: () => runs,
  subscriptions: () => subscriptions,
  disposeView,
  destroy() {
    disposeView();
    flow.destroy();
  },
};
document.documentElement.dataset.ready = "true";
