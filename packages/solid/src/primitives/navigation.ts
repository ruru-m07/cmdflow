import { type Accessor, createComponent, type JSX, splitProps, useContext } from "solid-js";

import { createBoundProps, renderElement } from "../bindings.js";
import { SurfaceContext, useCommandContext } from "../context.js";
import type { ElementProps } from "../merge-props.js";
import { createCmdFlowSelector, useCmdFlow } from "../selectors.js";
import type { SurfaceProps } from "./shared.js";

function surfaceAccessor(
  requested: Accessor<SurfaceProps["surface"]>,
): Accessor<"main" | "actions"> {
  const inherited = useContext(SurfaceContext);
  return () => requested() ?? inherited;
}

export type DialogProps = Omit<JSX.DialogHtmlAttributes<HTMLDialogElement>, "open">;

export function createDialogProps(
  props: DialogProps = {},
): JSX.DialogHtmlAttributes<HTMLDialogElement> {
  const [, consumer] = splitProps(props as JSX.DialogHtmlAttributes<HTMLDialogElement>, ["open"]);
  const { controller, snapshot } = useCommandContext();
  return createBoundProps<HTMLDialogElement>(
    () => controller.getDialogProps(snapshot()) as unknown as ElementProps,
    consumer,
    (element) => controller.bindDialog(element),
  ) as JSX.DialogHtmlAttributes<HTMLDialogElement>;
}

export function Dialog(props: DialogProps): JSX.Element {
  return renderElement("dialog", createDialogProps(props) as ElementProps);
}

export function ActionPanel(props: JSX.HTMLAttributes<HTMLDivElement>): JSX.Element {
  const open = createCmdFlowSelector((snapshot) => snapshot.actionFrame !== null);
  return createComponent(SurfaceContext.Provider, {
    value: "actions",
    get children() {
      return renderElement(
        "div",
        createBoundProps<HTMLDivElement>(
          () => ({
            "aria-label": "Actions",
            role: props.role ?? "dialog",
            "data-cmdflow-part": "action-panel",
            "data-state": open() ? "open" : "closed",
            hidden: !open(),
          }),
          props,
        ),
      );
    },
  });
}

export function ActionPanelTrigger(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement>,
): JSX.Element {
  const { controller, snapshot } = useCommandContext();
  return renderElement(
    "button",
    createBoundProps<HTMLButtonElement>(
      () => ({
        ...(controller.getActionsTriggerProps(snapshot()) as unknown as ElementProps),
        type: "button",
      }),
      props,
    ),
  );
}

/** @deprecated Use {@link ActionPanel}. */
export const Actions = ActionPanel;
/** @deprecated Use {@link ActionPanelTrigger}. */
export const ActionsTrigger = ActionPanelTrigger;

export function Close(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const { controller, snapshot } = useCommandContext();
  return renderElement(
    "button",
    createBoundProps<HTMLButtonElement>(
      () => ({
        ...(controller.getCloseProps(snapshot()) as unknown as ElementProps),
        type: "button",
      }),
      props,
    ),
  );
}

export function Back(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & SurfaceProps,
): JSX.Element {
  const [local, consumer] = splitProps(props, ["surface"]);
  const surface = surfaceAccessor(() => local.surface);
  const { controller, snapshot } = useCommandContext();
  return renderElement(
    "button",
    createBoundProps<HTMLButtonElement>(
      () => ({
        ...(controller.getBackProps(surface(), snapshot()) as unknown as ElementProps),
        type: "button",
      }),
      consumer,
    ),
  );
}

export function Trigger(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const flow = useCmdFlow();
  return renderElement(
    "button",
    createBoundProps<HTMLButtonElement>(
      () => ({
        type: "button",
        "aria-haspopup": "dialog",
        onClick: () => flow.open(),
      }),
      props,
    ),
  );
}
