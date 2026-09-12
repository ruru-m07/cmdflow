"use client";

import type {
  CandidateId,
  CmdFlow,
  CmdFlowSnapshot,
  FrameSnapshot,
  ResolvedItem,
  Surface,
} from "@cmdflow/core";
import { createDomController } from "@cmdflow/dom";
import {
  type ComponentPropsWithoutRef,
  createContext,
  createElement,
  forwardRef,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

type Controller = ReturnType<typeof createDomController>;
export type DomOptions = NonNullable<Parameters<typeof createDomController>[1]>;
type Props = Record<string, unknown>;
type Binding<E> = (element: E) => () => void;
interface ContextValue {
  store: CmdFlow;
  controller: Controller;
}
const Context = createContext<ContextValue | null>(null);
const SurfaceContext = createContext<Surface>("main");
const useCommitEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

function useContextValue(): ContextValue {
  const context = useContext(Context);
  if (!context) throw new Error("CmdFlow primitives must be inside Command.Root.");
  return context;
}

/** The host owns the store and its lifetime. Unmounting a Root only releases DOM bindings. */
export function Root<T>({
  store,
  children,
  options,
}: {
  store: CmdFlow<T>;
  children?: ReactNode;
  options?: Omit<DomOptions, "eventMode">;
}) {
  const instanceId = useId();
  const controller = useMemo(
    () =>
      createDomController(store, { ...options, id: options?.id ?? instanceId, eventMode: "props" }),
    [store, options, instanceId],
  );
  const snapshot = useCmdflowSelector((value) => value, store);
  useCommitEffect(() => controller.sync(snapshot), [controller, snapshot]);
  const context = useMemo(() => ({ store, controller }) as ContextValue, [store, controller]);
  return createElement(Context.Provider, { value: context }, children);
}

export const Provider = Root;

export function useCmdflowStore<T = unknown>(): CmdFlow<T> {
  return useContextValue().store as CmdFlow<T>;
}

/** Cached selector outputs satisfy useSyncExternalStore even for derived object selections. */
export function useCmdflowSelector<Selected, T = unknown>(
  selector: (snapshot: CmdFlowSnapshot) => Selected,
  suppliedStore?: CmdFlow<T>,
  equal: (left: Selected, right: Selected) => boolean = Object.is,
): Selected {
  const context = useContext(Context);
  const store = suppliedStore ?? context?.store;
  if (!store) throw new Error("Supply a CmdFlow store or render inside Command.Root.");
  const cache = useMemo(() => {
    let initialized = false;
    let previousSnapshot: CmdFlowSnapshot;
    let previous: Selected;
    const select = (snapshot: CmdFlowSnapshot) => {
      if (initialized && previousSnapshot === snapshot) return previous;
      const next = selector(snapshot);
      previousSnapshot = snapshot;
      if (!initialized || !equal(previous, next)) previous = next;
      initialized = true;
      return previous;
    };
    return {
      client: () => select(store.getSnapshot()),
      server: () => select(store.getServerSnapshot()),
    };
  }, [store, selector, equal]);
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  return useSyncExternalStore(subscribe, cache.client, cache.server);
}

export function useCmdflow() {
  const context = useContextValue();
  const snapshot = useCmdflowSelector((value) => value);
  return { ...context, snapshot };
}

function frameFor(snapshot: CmdFlowSnapshot, surface: Surface): FrameSnapshot | null {
  return surface === "actions" ? snapshot.actionFrame : snapshot.current;
}

export function useCmdflowFrame(surface?: Surface): FrameSnapshot | null {
  const inheritedSurface = useContext(SurfaceContext);
  return useCmdflowSelector((snapshot) => frameFor(snapshot, surface ?? inheritedSurface));
}

/** Consumers run first and can prevent the library's default behavior. Required ARIA wins. */
export function mergeProps<Output extends Props>(internal: Props, consumer: Output): Output {
  const merged: Props = { ...consumer, ...internal };
  for (const key of Object.keys(internal)) {
    if (/^on[A-Z]/.test(key) && typeof internal[key] === "function") {
      const libraryHandler = internal[key] as (event: Event) => void;
      const consumerHandler = consumer[key] as ((event: SyntheticEvent) => void) | undefined;
      merged[key] = (event: SyntheticEvent) => {
        consumerHandler?.(event);
        if (!event.defaultPrevented)
          libraryHandler(event.nativeEvent ?? (event as unknown as Event));
      };
    }
  }
  if (consumer.className !== undefined) merged.className = consumer.className;
  if (consumer.style !== undefined)
    merged.style = { ...(internal.style as object), ...(consumer.style as object) };
  for (const key of ["aria-label", "aria-labelledby", "aria-describedby"] as const) {
    if (consumer[key] !== undefined) {
      merged[key] =
        key === "aria-describedby" && internal[key]
          ? `${consumer[key]} ${internal[key]}`
          : consumer[key];
    }
  }
  return merged as Output;
}

export function composeRefs<E>(
  ...refs: readonly (Ref<E> | undefined)[]
): (element: E | null) => void {
  const cleanups = new Map<Ref<E>, () => void>();
  return (element) => {
    for (const ref of refs) {
      const previousCleanup = ref ? cleanups.get(ref) : undefined;
      previousCleanup?.();
      if (ref) cleanups.delete(ref);
      if (typeof ref === "function") {
        if (element === null && previousCleanup) continue;
        const cleanup = ref(element);
        if (typeof cleanup === "function") cleanups.set(ref, cleanup);
      } else if (ref) ref.current = element;
    }
  };
}

function useBinding<E>(bind: Binding<E>, forwardedRef?: Ref<E>) {
  const cleanup = useRef<(() => void) | undefined>(undefined);
  const ref = useCallback(
    (element: E | null) => {
      cleanup.current?.();
      cleanup.current = element ? bind(element) : undefined;
    },
    [bind],
  );
  return useMemo(() => composeRefs(ref, forwardedRef), [ref, forwardedRef]);
}

function useSurface(surface?: Surface): Surface {
  const inherited = useContext(SurfaceContext);
  return surface ?? inherited;
}

type SurfaceProps = { surface?: Surface };
export type InputProps = Omit<ComponentPropsWithoutRef<"input">, "value" | "defaultValue"> &
  SurfaceProps;
export type DialogProps = Omit<ComponentPropsWithoutRef<"dialog">, "open">;

export function useInputProps(props: InputProps = {}, forwardedRef?: Ref<HTMLInputElement>) {
  const {
    surface: requestedSurface,
    value: _value,
    defaultValue: _defaultValue,
    ...consumer
  } = props as ComponentPropsWithoutRef<"input"> & SurfaceProps;
  const surface = useSurface(requestedSurface);
  const { controller, snapshot } = useCmdflow();
  const frameId = frameFor(snapshot, surface)?.id;
  const bind = useCallback(
    (element: HTMLInputElement) =>
      controller.bindInput(element, frameId ? { surface, frameId } : surface),
    [controller, surface, frameId],
  );
  const ref = useBinding(bind, forwardedRef);
  return { ...mergeProps(controller.getInputProps(surface, snapshot), consumer), ref };
}

export const Input = forwardRef<HTMLInputElement, InputProps>((props, ref) =>
  createElement("input", useInputProps(props, ref)),
);
Input.displayName = "Command.Input";

export const Dialog = forwardRef<HTMLDialogElement, DialogProps>((props, forwardedRef) => {
  const { open: _open, ...consumer } = props as ComponentPropsWithoutRef<"dialog">;
  const { controller, snapshot } = useCmdflow();
  const bind = useCallback(
    (element: HTMLDialogElement) => controller.bindDialog(element),
    [controller],
  );
  const ref = useBinding(bind, forwardedRef);
  return createElement("dialog", {
    ...mergeProps(controller.getDialogProps(snapshot), consumer),
    ref,
  });
});
Dialog.displayName = "Command.Dialog";

export type ListProps = Omit<ComponentPropsWithoutRef<"div">, "children"> &
  SurfaceProps & {
    children?: ReactNode | ((item: ResolvedItem, index: number) => ReactNode);
  };
export const List = forwardRef<HTMLDivElement, ListProps>((props, forwardedRef) => {
  const { surface: requestedSurface, children, ...consumer } = props;
  const surface = useSurface(requestedSurface);
  const { controller } = useContextValue();
  const selected = useCmdflowSelector(
    (snapshot) => {
      const frame = frameFor(snapshot, surface);
      return {
        snapshot,
        items: frame?.items,
        frameId: frame?.id,
        title: frame?.view.title,
        selectionMode: frame?.view.selectionMode,
        loading: frame?.sources.some((source) => source.status === "loading"),
      };
    },
    undefined,
    equalItemState,
  );
  const { frameId, snapshot } = selected;
  const bind = useCallback(
    (element: HTMLDivElement) =>
      controller.bindList(element, frameId ? { surface, frameId } : surface),
    [controller, surface, frameId],
  );
  const ref = useBinding(bind, forwardedRef);
  return createElement(
    "div",
    { ...mergeProps(controller.getListProps(surface, snapshot), consumer), ref },
    typeof children === "function" ? selected.items?.map(children) : children,
  );
});
List.displayName = "Command.List";

export type ItemProps = ComponentPropsWithoutRef<"div"> &
  SurfaceProps & {
    item: ResolvedItem | CandidateId;
  };

function equalItemState(left: Props, right: Props): boolean {
  return Object.keys(left).every((key) => key === "snapshot" || Object.is(left[key], right[key]));
}

export function useItemProps(props: ItemProps, forwardedRef?: Ref<HTMLDivElement>) {
  const { item, surface: requestedSurface, ...consumer } = props;
  const surface = useSurface(requestedSurface);
  const id = typeof item === "string" ? item : item.candidateId;
  const { controller } = useContextValue();
  const selected = useCmdflowSelector(
    (snapshot) => {
      const frame = frameFor(snapshot, surface);
      const resolved = frame?.items.find((candidate) => candidate.candidateId === id);
      return {
        snapshot,
        frameId: frame?.id,
        active: frame?.activeId === id,
        selected: frame?.selectedIds.includes(id),
        mode: frame?.view.selectionMode,
        disabled: resolved?.disabled,
        disabledReason: resolved?.disabledReason,
        title: resolved?.title,
        index: frame?.items.findIndex((candidate) => candidate.candidateId === id),
        count: frame?.items.length,
        incomplete: frame?.sources.some(
          (source) => source.status === "loading" || source.nextCursor !== undefined,
        ),
      };
    },
    undefined,
    equalItemState,
  );
  const bind = useCallback(
    (element: HTMLDivElement) =>
      controller.registerItem(
        id,
        element,
        selected.frameId ? { surface, frameId: selected.frameId } : surface,
      ),
    [controller, id, surface, selected.frameId],
  );
  const ref = useBinding(bind, forwardedRef);
  return {
    ...mergeProps(controller.getItemProps(id, surface, selected.snapshot), {
      children: selected.title,
      ...consumer,
    }),
    ref,
  };
}

export const Item = forwardRef<HTMLDivElement, ItemProps>((props, ref) =>
  createElement("div", useItemProps(props, ref)),
);
Item.displayName = "Command.Item";

/** A searchable second surface, scoped to its own query, navigation stack, and active item. */
export const Actions = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>((props, ref) => {
  const open = useCmdflowSelector((snapshot) => snapshot.actionFrame !== null);
  return createElement(
    SurfaceContext.Provider,
    { value: "actions" },
    createElement("div", {
      "aria-label": "Actions",
      ...props,
      ref,
      role: "dialog",
      "data-cmdflow-actions": "",
      hidden: !open,
    }),
  );
});
Actions.displayName = "Command.Actions";

export const ActionsTrigger = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button">>(
  (props, ref) => {
    const { controller, snapshot } = useCmdflow();
    return createElement("button", {
      ...mergeProps(controller.getActionsTriggerProps(snapshot), props),
      type: "button",
      ref,
    });
  },
);
ActionsTrigger.displayName = "Command.ActionsTrigger";

export const Close = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button">>(
  (props, ref) => {
    const { controller, snapshot } = useCmdflow();
    return createElement("button", {
      ...mergeProps(controller.getCloseProps(snapshot), props),
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
  const { controller, snapshot } = useCmdflow();
  return createElement("button", {
    ...mergeProps(controller.getBackProps(surface, snapshot), consumer),
    type: "button",
    ref,
  });
});
Back.displayName = "Command.Back";

export const Form = forwardRef<HTMLFormElement, ComponentPropsWithoutRef<"form"> & SurfaceProps>(
  (props, forwardedRef) => {
    const { surface: requestedSurface, ...consumer } = props;
    const surface = useSurface(requestedSurface);
    const { controller, snapshot } = useCmdflow();
    const frameId = frameFor(snapshot, surface)?.id;
    const bind = useCallback(
      (element: HTMLFormElement) =>
        controller.bindForm(element, frameId ? { surface, frameId } : surface),
      [controller, surface, frameId],
    );
    const ref = useBinding(bind, forwardedRef);
    return createElement("form", {
      noValidate: true,
      ...mergeProps(controller.getFormProps(surface, snapshot), consumer),
      ref,
    });
  },
);
Form.displayName = "Command.Form";

export type FieldProps = ComponentPropsWithoutRef<"input"> & SurfaceProps & { fieldId: string };
export function useFieldProps(props: FieldProps, forwardedRef?: Ref<HTMLInputElement>) {
  const { fieldId, surface: requestedSurface, ...consumer } = props;
  const surface = useSurface(requestedSurface);
  const { controller, snapshot } = useCmdflow();
  const frameId = frameFor(snapshot, surface)?.id;
  const bind = useCallback(
    (element: HTMLInputElement) =>
      controller.bindField(fieldId, element, frameId ? { surface, frameId } : surface),
    [controller, fieldId, surface, frameId],
  );
  const ref = useBinding(bind, forwardedRef);
  return { ...mergeProps(controller.getFieldProps(fieldId, surface, snapshot), consumer), ref };
}
export const Field = forwardRef<HTMLInputElement, FieldProps>((props, ref) =>
  createElement("input", useFieldProps(props, ref)),
);
Field.displayName = "Command.Field";

type NamedField = SurfaceProps & { fieldId: string };
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  ComponentPropsWithoutRef<"textarea"> & NamedField
>((props, forwardedRef) => {
  const { fieldId, surface: requestedSurface, ...consumer } = props;
  const surface = useSurface(requestedSurface);
  const { controller, snapshot } = useCmdflow();
  const frameId = frameFor(snapshot, surface)?.id;
  const bind = useCallback(
    (element: HTMLTextAreaElement) =>
      controller.bindField(fieldId, element, frameId ? { surface, frameId } : surface),
    [controller, fieldId, surface, frameId],
  );
  const ref = useBinding(bind, forwardedRef);
  return createElement("textarea", {
    ...mergeProps(controller.getFieldProps(fieldId, surface, snapshot), consumer),
    ref,
  });
});
Textarea.displayName = "Command.Textarea";

export const Select = forwardRef<
  HTMLSelectElement,
  ComponentPropsWithoutRef<"select"> & NamedField
>((props, forwardedRef) => {
  const { fieldId, surface: requestedSurface, ...consumer } = props;
  const surface = useSurface(requestedSurface);
  const { controller, snapshot } = useCmdflow();
  const frame = frameFor(snapshot, surface);
  const frameId = frame?.id;
  const bind = useCallback(
    (element: HTMLSelectElement) =>
      controller.bindField(fieldId, element, frameId ? { surface, frameId } : surface),
    [controller, fieldId, surface, frameId],
  );
  const ref = useBinding(bind, forwardedRef);
  const children =
    consumer.children ??
    frame?.view.fields
      .find((field) => field.id === fieldId)
      ?.options?.map((option) =>
        createElement("option", { key: option.value, value: option.value }, option.label),
      );
  return createElement(
    "select",
    { ...mergeProps(controller.getFieldProps(fieldId, surface, snapshot), consumer), ref },
    children,
  );
});
Select.displayName = "Command.Select";

export const FieldLabel = forwardRef<
  HTMLLabelElement,
  ComponentPropsWithoutRef<"label"> & NamedField
>((props, ref) => {
  const { fieldId, surface: requestedSurface, ...consumer } = props;
  const surface = useSurface(requestedSurface);
  const { controller, snapshot } = useCmdflow();
  const field = controller.getFieldProps(fieldId, surface, snapshot);
  return createElement(
    "label",
    { ...consumer, htmlFor: field.id, ref },
    consumer.children ?? field["aria-label"],
  );
});
FieldLabel.displayName = "Command.FieldLabel";

export const FieldError = forwardRef<
  HTMLParagraphElement,
  ComponentPropsWithoutRef<"p"> & NamedField
>((props, ref) => {
  const { fieldId, surface: requestedSurface, ...consumer } = props;
  const surface = useSurface(requestedSurface);
  const { controller, snapshot } = useCmdflow();
  const error = frameFor(snapshot, surface)?.form.errors[fieldId];
  return createElement(
    "p",
    {
      ...mergeProps(controller.getFieldErrorProps(fieldId, surface, snapshot), consumer),
      ref,
      hidden: !error,
    },
    consumer.children ?? error,
  );
});
FieldError.displayName = "Command.FieldError";

export const Trigger = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button">>(
  (props, ref) => {
    const store = useCmdflowStore();
    return createElement("button", {
      ...props,
      ref,
      type: "button",
      "aria-haspopup": "dialog",
      onClick: (event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) store.open();
      },
    });
  },
);
Trigger.displayName = "Command.Trigger";

export const Confirm = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button">>(
  (props, ref) => {
    const store = useCmdflowStore();
    return createElement("button", {
      ...props,
      ref,
      type: "button",
      onClick: (event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) void store.confirm();
      },
    });
  },
);
Confirm.displayName = "Command.Confirm";

export const CancelConfirmation = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button">>(
  (props, ref) => {
    const store = useCmdflowStore();
    return createElement("button", {
      ...props,
      ref,
      type: "button",
      onClick: (event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) store.cancelConfirmation();
      },
    });
  },
);
CancelConfirmation.displayName = "Command.CancelConfirmation";

export const Status = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(
  (props, forwardedRef) => {
    const { controller, snapshot } = useCmdflow();
    const bind = useCallback(
      (element: HTMLDivElement) => controller.bindStatus(element),
      [controller],
    );
    const ref = useBinding(bind, forwardedRef);
    return createElement("div", { ...mergeProps(controller.getStatusProps(snapshot), props), ref });
  },
);
Status.displayName = "Command.Status";

export const Confirmation = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(
  (props, forwardedRef) => {
    const { controller, snapshot } = useCmdflow();
    const bind = useCallback(
      (element: HTMLDivElement) => controller.bindConfirmation(element),
      [controller],
    );
    const ref = useBinding(bind, forwardedRef);
    return createElement("div", {
      ...mergeProps(controller.getConfirmationProps(snapshot), props),
      hidden: snapshot.confirmation === null,
      ref,
    });
  },
);
Confirmation.displayName = "Command.Confirmation";

export const Command = {
  Root,
  Provider,
  Dialog,
  Input,
  List,
  Item,
  Actions,
  ActionsTrigger,
  Close,
  Back,
  Form,
  Field,
  Textarea,
  Select,
  FieldLabel,
  FieldError,
  Trigger,
  Confirm,
  CancelConfirmation,
  Status,
  Confirmation,
};
