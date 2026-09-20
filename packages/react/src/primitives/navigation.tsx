"use client";

import type { CmdFlowSnapshot } from "@cmdflow/core";
import {
  type ComponentPropsWithoutRef,
  createElement,
  forwardRef,
  type Ref,
  useCallback,
} from "react";

import { useElementBinding } from "../bindings.js";
import { SurfaceContext } from "../context.js";
import { mergeProps } from "../merge-props.js";
import { type PrimitiveRender, renderPrimitive } from "../render.js";
import {
  frameFor,
  useCmdFlow,
  useCmdFlowSelector,
  useCommandContext,
  useSurface,
} from "../selectors.js";
import type { BoundProps, SurfaceProps } from "./shared.js";

type DialogElementProps = BoundProps<HTMLDialogElement, ComponentPropsWithoutRef<"dialog">>;

export type DialogProps = Omit<ComponentPropsWithoutRef<"dialog">, "open"> & {
  readonly render?: PrimitiveRender<DialogElementProps>;
};

interface DialogState {
  readonly snapshot: CmdFlowSnapshot;
  readonly open: boolean;
  readonly confirmationId?: string;
}

function equalDialogState(left: DialogState, right: DialogState): boolean {
  return left.open === right.open && left.confirmationId === right.confirmationId;
}

export function useDialogProps(
  props: Omit<DialogProps, "render"> = {},
  forwardedRef?: Ref<HTMLDialogElement>,
): DialogElementProps {
  const { open: _open, ...consumer } = props as ComponentPropsWithoutRef<"dialog">;
  const { controller } = useCommandContext();
  const selected = useCmdFlowSelector(
    (snapshot): DialogState => ({
      snapshot,
      open: snapshot.open,
      confirmationId: snapshot.confirmation?.id,
    }),
    undefined,
    equalDialogState,
  );
  const bind = useCallback(
    (element: HTMLDialogElement) => controller.bindDialog(element),
    [controller],
  );
  const ref = useElementBinding(bind, forwardedRef);
  return {
    ...mergeProps(controller.getDialogProps(selected.snapshot), consumer),
    ref,
  };
}

export const Dialog = forwardRef<HTMLDialogElement, DialogProps>((props, ref) => {
  const { render, ...consumer } = props;
  return renderPrimitive("dialog", useDialogProps(consumer, ref), render);
});
Dialog.displayName = "Command.Dialog";

export const ActionPanel = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(
  (props, ref) => {
    const open = useCmdFlowSelector((snapshot) => snapshot.actionFrame !== null);
    return createElement(
      SurfaceContext.Provider,
      { value: "actions" },
      createElement("div", {
        "aria-label": "Actions",
        ...props,
        ref,
        role: props.role ?? "dialog",
        "data-cmdflow-part": "action-panel",
        "data-state": open ? "open" : "closed",
        hidden: !open,
      }),
    );
  },
);
ActionPanel.displayName = "Command.ActionPanel";

export const ActionPanelTrigger = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button">>(
  (props, ref) => {
    const { controller } = useCommandContext();
    const selected = useCmdFlowSelector(
      (snapshot) => ({ snapshot, open: snapshot.actionFrame !== null }),
      undefined,
      (left, right) => left.open === right.open,
    );
    return createElement("button", {
      ...mergeProps(controller.getActionsTriggerProps(selected.snapshot), props),
      type: "button",
      ref,
    });
  },
);
ActionPanelTrigger.displayName = "Command.ActionPanelTrigger";

/** @deprecated Use {@link ActionPanel}. */
export const Actions = ActionPanel;
/** @deprecated Use {@link ActionPanelTrigger}. */
export const ActionsTrigger = ActionPanelTrigger;

export const Close = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button">>(
  (props, ref) => {
    const { controller } = useCommandContext();
    return createElement("button", {
      ...mergeProps(controller.getCloseProps(), props),
      type: "button",
      ref,
    });
  },
);
Close.displayName = "Command.Close";

export const Back = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<"button"> & SurfaceProps
>((props, ref) => {
  const { surface: requestedSurface, ...consumer } = props;
  const surface = useSurface(requestedSurface);
  const { controller } = useCommandContext();
  const selected = useCmdFlowSelector(
    (snapshot) => ({ snapshot, frameId: frameFor(snapshot, surface)?.id }),
    undefined,
    (left, right) => left.frameId === right.frameId,
  );
  return createElement("button", {
    ...mergeProps(controller.getBackProps(surface, selected.snapshot), consumer),
    type: "button",
    ref,
  });
});
Back.displayName = "Command.Back";

type TriggerElementProps = ComponentPropsWithoutRef<"button"> & {
  readonly ref?: Ref<HTMLButtonElement>;
};

export type TriggerProps = ComponentPropsWithoutRef<"button"> & {
  readonly render?: PrimitiveRender<TriggerElementProps>;
};

export const Trigger = forwardRef<HTMLButtonElement, TriggerProps>((props, ref) => {
  const { render, ...consumer } = props;
  const flow = useCmdFlow();
  const elementProps: TriggerElementProps = {
    ...consumer,
    ref,
    type: "button",
    "aria-haspopup": "dialog",
    onClick: (event) => {
      consumer.onClick?.(event);
      if (!event.defaultPrevented) flow.open();
    },
  };
  return renderPrimitive("button", elementProps, render);
});
Trigger.displayName = "Command.Trigger";
