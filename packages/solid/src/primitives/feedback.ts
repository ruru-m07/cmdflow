import type { CmdFlowFrameSnapshot, CmdFlowViewSnapshot } from "@cmdflow/core";
import { type Accessor, createMemo, type JSX, splitProps, useContext } from "solid-js";

import { createBoundProps, renderElement } from "../bindings.js";
import { SurfaceContext, useCommandContext } from "../context.js";
import type { ElementProps } from "../merge-props.js";
import { createCmdFlowSelector, frameFor, useCmdFlow } from "../selectors.js";
import type { SurfaceProps } from "./shared.js";

function surfaceAccessor(
  requested: Accessor<SurfaceProps["surface"]>,
): Accessor<"main" | "actions"> {
  const inherited = useContext(SurfaceContext);
  return () => requested() ?? inherited;
}

export type ViewProps<TData = unknown> = Omit<JSX.HTMLAttributes<HTMLDivElement>, "children"> &
  SurfaceProps & {
    readonly viewId?: string;
    readonly type?: CmdFlowViewSnapshot["type"];
    readonly forceMount?: boolean;
    readonly children?: JSX.Element | ((frame: CmdFlowFrameSnapshot<TData>) => JSX.Element);
  };

export function View<TData = unknown>(props: ViewProps<TData>): JSX.Element {
  const [local, consumer] = splitProps(props, [
    "surface",
    "viewId",
    "type",
    "forceMount",
    "children",
  ]);
  const surface = surfaceAccessor(() => local.surface);
  const frame = createCmdFlowSelector<CmdFlowFrameSnapshot<TData> | null, unknown, TData>(
    (snapshot) => frameFor(snapshot, surface()),
  );
  const active = createMemo(
    () =>
      Boolean(frame()) &&
      (!local.viewId || frame()?.view.id === local.viewId) &&
      (!local.type || frame()?.view.type === local.type),
  );

  return renderElement(
    "div",
    createBoundProps<HTMLDivElement>(
      () => ({
        "data-cmdflow-part": "view",
        "data-cmdflow-view": frame()?.view.id,
        "data-cmdflow-view-type": frame()?.view.type,
        "data-state": active() ? "active" : "inactive",
        hidden: !local.forceMount && !active(),
        children:
          typeof local.children === "function"
            ? frame()
              ? local.children(frame() as CmdFlowFrameSnapshot<TData>)
              : undefined
            : local.children,
      }),
      consumer,
    ),
  );
}

export function Confirm(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const flow = useCmdFlow();
  return renderElement(
    "button",
    createBoundProps<HTMLButtonElement>(
      () => ({
        type: "button",
        onClick: () => {
          void flow.confirm();
        },
      }),
      props,
    ),
  );
}

export function CancelConfirmation(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement>,
): JSX.Element {
  const flow = useCmdFlow();
  return renderElement(
    "button",
    createBoundProps<HTMLButtonElement>(
      () => ({
        type: "button",
        onClick: () => flow.cancelConfirmation(),
      }),
      props,
    ),
  );
}

export function Status(props: JSX.HTMLAttributes<HTMLDivElement>): JSX.Element {
  const { controller, snapshot } = useCommandContext();
  return renderElement(
    "div",
    createBoundProps<HTMLDivElement>(
      () => controller.getStatusProps(snapshot()) as unknown as ElementProps,
      props,
      (element) => controller.bindStatus(element),
    ),
  );
}

export function Confirmation(props: JSX.HTMLAttributes<HTMLDivElement>): JSX.Element {
  const { controller, snapshot } = useCommandContext();
  return renderElement(
    "div",
    createBoundProps<HTMLDivElement>(
      () => ({
        ...(controller.getConfirmationProps(snapshot()) as unknown as ElementProps),
        hidden: snapshot().confirmation === null,
      }),
      props,
      (element) => controller.bindConfirmation(element),
    ),
  );
}
