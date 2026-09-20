"use client";

import type { CmdFlowFrameSnapshot, CmdFlowViewSnapshot } from "@cmdflow/core";
import {
  type ComponentPropsWithoutRef,
  createElement,
  forwardRef,
  type ReactNode,
  useCallback,
} from "react";

import { useElementBinding } from "../bindings.js";
import { mergeProps } from "../merge-props.js";
import {
  frameFor,
  useCmdFlow,
  useCmdFlowSelector,
  useCommandContext,
  useSurface,
} from "../selectors.js";
import type { SurfaceProps } from "./shared.js";

export type ViewProps = Omit<ComponentPropsWithoutRef<"div">, "children"> &
  SurfaceProps & {
    readonly viewId?: string;
    readonly type?: CmdFlowViewSnapshot["type"];
    readonly forceMount?: boolean;
    readonly children?: ReactNode | ((frame: CmdFlowFrameSnapshot) => ReactNode);
  };

export const View = forwardRef<HTMLDivElement, ViewProps>((props, ref) => {
  const {
    surface: requestedSurface,
    viewId,
    type,
    forceMount = false,
    children,
    ...consumer
  } = props;
  const surface = useSurface(requestedSurface);
  const frame = useCmdFlowSelector((snapshot) => frameFor(snapshot, surface));
  const active = Boolean(
    frame && (!viewId || frame.view.id === viewId) && (!type || frame.view.type === type),
  );
  const content = typeof children === "function" ? (frame ? children(frame) : null) : children;
  return createElement(
    "div",
    {
      ...consumer,
      ref,
      "data-cmdflow-part": "view",
      "data-cmdflow-view": frame?.view.id,
      "data-cmdflow-view-type": frame?.view.type,
      "data-state": active ? "active" : "inactive",
      hidden: !forceMount && !active,
    },
    content,
  );
});
View.displayName = "Command.View";

export const Confirm = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button">>(
  (props, ref) => {
    const flow = useCmdFlow();
    return createElement("button", {
      ...props,
      ref,
      type: "button",
      onClick: (event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) void flow.confirm();
      },
    });
  },
);
Confirm.displayName = "Command.Confirm";

export const CancelConfirmation = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button">>(
  (props, ref) => {
    const flow = useCmdFlow();
    return createElement("button", {
      ...props,
      ref,
      type: "button",
      onClick: (event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) flow.cancelConfirmation();
      },
    });
  },
);
CancelConfirmation.displayName = "Command.CancelConfirmation";

export const Status = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(
  (props, forwardedRef) => {
    const { controller } = useCommandContext();
    const bind = useCallback(
      (element: HTMLDivElement) => controller.bindStatus(element),
      [controller],
    );
    const ref = useElementBinding(bind, forwardedRef);
    return createElement("div", { ...mergeProps(controller.getStatusProps(), props), ref });
  },
);
Status.displayName = "Command.Status";

export const Confirmation = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(
  (props, forwardedRef) => {
    const { controller } = useCommandContext();
    const selected = useCmdFlowSelector(
      (snapshot) => ({ snapshot, confirmation: snapshot.confirmation }),
      undefined,
      (left, right) => left.confirmation === right.confirmation,
    );
    const bind = useCallback(
      (element: HTMLDivElement) => controller.bindConfirmation(element),
      [controller],
    );
    const ref = useElementBinding(bind, forwardedRef);
    return createElement("div", {
      ...mergeProps(controller.getConfirmationProps(selected.snapshot), props),
      hidden: selected.confirmation === null,
      ref,
    });
  },
);
Confirmation.displayName = "Command.Confirmation";
