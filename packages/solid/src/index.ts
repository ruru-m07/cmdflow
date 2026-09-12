import type {
  CandidateId,
  CmdFlow,
  CmdFlowSnapshot,
  FrameSnapshot,
  ResolvedItem,
  Surface,
  SurfaceAddress,
} from "@cmdflow/core";
import { createDomController } from "@cmdflow/dom";
import {
  type Accessor,
  createComponent,
  createContext,
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  onCleanup,
  onMount,
  splitProps,
  useContext,
} from "solid-js";
import { Dynamic, isServer } from "solid-js/web";

type Controller = ReturnType<typeof createDomController>;
export type DomOptions = NonNullable<Parameters<typeof createDomController>[1]>;
type Props = Record<string, unknown>;
export interface CmdflowBinding<T = unknown> {
  readonly store: CmdFlow<T>;
  readonly controller: Controller;
  readonly snapshot: Accessor<CmdFlowSnapshot>;
}
const Context = createContext<CmdflowBinding>();
const SurfaceContext = createContext<Surface>("main");

/** Call under a Solid owner. The same store can also be consumed by React or vanilla DOM. */
export function createCmdflow<T>(
  store: CmdFlow<T>,
  options?: Omit<DomOptions, "eventMode">,
): CmdflowBinding<T> {
  const [snapshot, setSnapshot] = createSignal(
    isServer ? store.getServerSnapshot() : store.getSnapshot(),
  );
  const controller = createDomController(store, {
    ...options,
    id: options?.id ?? createUniqueId(),
    eventMode: "props",
  });
  onMount(() => {
    const update = () => setSnapshot(store.getSnapshot());
    const unsubscribe = store.subscribe(update);
    update();
    onCleanup(unsubscribe);
  });
  createEffect(() => controller.sync(snapshot()));
  onCleanup(() => controller.destroy());
  return { store, controller: controller as Controller, snapshot };
}

export function Root<T>(props: {
  store: CmdFlow<T>;
  options?: Omit<DomOptions, "eventMode">;
  children?: JSX.Element;
}): JSX.Element {
  const binding = createCmdflow(props.store, props.options);
  return createComponent(Context.Provider, {
    value: binding as CmdflowBinding,
    get children() {
      return props.children;
    },
  });
}
export const Provider = Root;

export function useCmdflow<T = unknown>(): CmdflowBinding<T> {
  const binding = useContext(Context);
  if (!binding) throw new Error("CmdFlow primitives must be inside Command.Root.");
  return binding as CmdflowBinding<T>;
}

export function useCmdflowStore<T = unknown>(): CmdFlow<T> {
  return useCmdflow<T>().store;
}

export function createCmdflowSelector<Selected>(
  selector: (snapshot: CmdFlowSnapshot) => Selected,
  binding: CmdflowBinding = useCmdflow(),
  equal: (left: Selected, right: Selected) => boolean = Object.is,
): Accessor<Selected> {
  return createMemo(() => selector(binding.snapshot()), undefined, { equals: equal });
}

function frameFor(snapshot: CmdFlowSnapshot, surface: Surface): FrameSnapshot | null {
  return surface === "actions" ? snapshot.actionFrame : snapshot.current;
}

function createAddress(surface: () => Surface): Accessor<SurfaceAddress> {
  const { snapshot } = useCmdflow();
  return createMemo(
    () => ({ surface: surface(), frameId: frameFor(snapshot(), surface())?.id ?? "absent" }),
    undefined,
    { equals: (left, right) => left.surface === right.surface && left.frameId === right.frameId },
  );
}

export function createCmdflowFrame(surface?: Surface): Accessor<FrameSnapshot | null> {
  const resolved = surface ?? useContext(SurfaceContext);
  return createCmdflowSelector((snapshot) => frameFor(snapshot, resolved));
}

/** Native Solid handlers may use either a function or the [handler, data] form. */
function callHandler(handler: unknown, event: Event) {
  if (typeof handler === "function") handler(event);
  else if (Array.isArray(handler) && typeof handler[0] === "function")
    handler[0](handler[1], event);
}

export function mergeProps(internal: Props, input: object): Props {
  const consumer = input as Props;
  const merged: Props = { ...consumer, ...internal };
  for (const key of Object.keys(internal)) {
    if (/^on[A-Z]/.test(key) && typeof internal[key] === "function") {
      const library = internal[key] as (event: Event) => void;
      const handler = consumer[key] ?? consumer[key.toLowerCase()];
      merged[key] = (event: Event) => {
        callHandler(handler, event);
        if (!event.defaultPrevented) library(event);
      };
      delete merged[key.toLowerCase()];
    }
  }
  if (consumer.class !== undefined) merged.class = consumer.class;
  if (consumer.style !== undefined) {
    merged.style =
      typeof consumer.style === "string"
        ? consumer.style
        : { ...(internal.style as object), ...(consumer.style as object) };
  }
  for (const key of ["aria-label", "aria-labelledby", "aria-describedby"] as const) {
    if (consumer[key] !== undefined) {
      merged[key] =
        key === "aria-describedby" && internal[key]
          ? `${consumer[key]} ${internal[key]}`
          : consumer[key];
    }
  }
  return merged;
}

export function composeRefs<E>(...refs: readonly (((element: E) => void) | undefined)[]) {
  return (element: E) => {
    for (const ref of refs) ref?.(element);
  };
}

function reactiveProps(
  getter: () => Props,
  consumer: object,
  binding?: (element: HTMLElement) => () => void,
): Props {
  const [local, rest] = splitProps(consumer as Props, ["children", "ref"]);
  const children = createMemo(() => local.children);
  const combined = createMemo(() => {
    const props = mergeProps(getter(), rest);
    if (children() !== undefined) props.children = children();
    return props;
  });
  const [mountedElement, setMountedElement] = createSignal<HTMLElement>();
  createRenderEffect(() => {
    const mounted = mountedElement();
    if (mounted && binding) onCleanup(binding(mounted));
  });
  const ref = (element: HTMLElement) => {
    setMountedElement(element);
    const consumerRef = local.ref;
    if (typeof consumerRef === "function") consumerRef(element);
  };
  return new Proxy(
    {},
    {
      get: (_, key) => (key === "ref" ? ref : combined()[key as string]),
      has: (_, key) => key === "ref" || key in combined(),
      ownKeys: () => [...new Set([...Object.keys(combined()), "ref"])],
      getOwnPropertyDescriptor: (_, key) => ({
        enumerable: true,
        configurable: true,
        get: () => (key === "ref" ? ref : combined()[key as string]),
      }),
    },
  );
}

function element(component: keyof JSX.IntrinsicElements, props: Props): JSX.Element {
  return createComponent(
    Dynamic,
    new Proxy(props, {
      get: (target, key) => (key === "component" ? component : target[key as string]),
      has: (target, key) => key === "component" || key in target,
      ownKeys: (target) => [...new Set([...Reflect.ownKeys(target), "component"])],
      getOwnPropertyDescriptor: (target, key) => ({
        enumerable: true,
        configurable: true,
        get: () => (key === "component" ? component : target[key as string]),
      }),
    }) as Parameters<typeof Dynamic>[0],
  );
}

type SurfaceProps = { surface?: Surface };
export type InputProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue"> &
  SurfaceProps;
export type DialogProps = Omit<JSX.DialogHtmlAttributes<HTMLDialogElement>, "open">;

export function createInputProps(
  props: InputProps = {},
): JSX.InputHTMLAttributes<HTMLInputElement> {
  const [local, consumer] = splitProps(
    props as JSX.InputHTMLAttributes<HTMLInputElement> & SurfaceProps & { defaultValue?: unknown },
    ["surface", "value", "defaultValue"],
  );
  const inherited = useContext(SurfaceContext);
  const { controller, snapshot } = useCmdflow();
  const address = createAddress(() => local.surface ?? inherited);
  return reactiveProps(
    () => controller.getInputProps(local.surface ?? inherited, snapshot()),
    consumer,
    (el) => controller.bindInput(el as HTMLInputElement, address()),
  );
}
export function Input(props: InputProps): JSX.Element {
  return element("input", createInputProps(props) as Props);
}

export function Dialog(props: DialogProps): JSX.Element {
  const [, consumer] = splitProps(props as JSX.DialogHtmlAttributes<HTMLDialogElement>, ["open"]);
  const { controller, snapshot } = useCmdflow();
  return element(
    "dialog",
    reactiveProps(
      () => controller.getDialogProps(snapshot()),
      consumer,
      (el) => controller.bindDialog(el as HTMLDialogElement),
    ),
  );
}

export type ListProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, "children"> &
  SurfaceProps & {
    children?: JSX.Element | ((item: ResolvedItem, index: Accessor<number>) => JSX.Element);
  };
export function List(props: ListProps): JSX.Element {
  const [local, consumer] = splitProps(props, ["surface", "children"]);
  const inherited = useContext(SurfaceContext);
  const { controller, snapshot } = useCmdflow();
  const address = createAddress(() => local.surface ?? inherited);
  const ids = createMemo(
    () =>
      frameFor(snapshot(), local.surface ?? inherited)?.items.map((item) => item.candidateId) ?? [],
    undefined,
    {
      equals: (left, right) =>
        left.length === right.length && left.every((id, index) => id === right[index]),
    },
  );
  const children = createComponent(For, {
    get each() {
      return ids();
    },
    children: (id: CandidateId, index: Accessor<number>) => {
      const resolve = () =>
        frameFor(snapshot(), local.surface ?? inherited)?.items.find(
          (entry) => entry.candidateId === id,
        );
      const item = new Proxy({} as ResolvedItem, {
        get: (_, key) => resolve()?.[key as keyof ResolvedItem],
        has: (_, key) => key in (resolve() ?? {}),
        ownKeys: () => Reflect.ownKeys(resolve() ?? {}),
        getOwnPropertyDescriptor: (_, key) => ({
          enumerable: true,
          configurable: true,
          get: () => resolve()?.[key as keyof ResolvedItem],
        }),
      });
      return typeof local.children === "function" ? local.children(item, index) : undefined;
    },
  });
  return element(
    "div",
    reactiveProps(
      () => ({
        ...controller.getListProps(local.surface ?? inherited, snapshot()),
        children: typeof local.children === "function" ? children : local.children,
      }),
      consumer,
      (el) => controller.bindList(el, address()),
    ),
  );
}

export type ItemProps = JSX.HTMLAttributes<HTMLDivElement> &
  SurfaceProps & { item: ResolvedItem | CandidateId };
export function createItemProps(props: ItemProps): JSX.HTMLAttributes<HTMLDivElement> {
  const [local, consumer] = splitProps(props, ["surface", "item"]);
  const inherited = useContext(SurfaceContext);
  const { controller, snapshot } = useCmdflow();
  const address = createAddress(() => local.surface ?? inherited);
  const id = () => (typeof local.item === "string" ? local.item : local.item.candidateId);
  return reactiveProps(
    () => ({
      children:
        typeof local.item === "string"
          ? frameFor(snapshot(), local.surface ?? inherited)?.items.find(
              (item) => item.candidateId === id(),
            )?.title
          : local.item.title,
      ...controller.getItemProps(id(), local.surface ?? inherited, snapshot()),
      ...(consumer.children !== undefined ? { children: consumer.children } : {}),
    }),
    consumer,
    (el) => controller.registerItem(id(), el, address()),
  );
}
export function Item(props: ItemProps): JSX.Element {
  return element("div", createItemProps(props) as Props);
}

export function Actions(props: JSX.HTMLAttributes<HTMLDivElement>): JSX.Element {
  const binding = useCmdflow();
  return createComponent(SurfaceContext.Provider, {
    value: "actions",
    get children() {
      return element(
        "div",
        reactiveProps(
          () => ({
            "data-cmdflow-actions": "",
            role: "dialog",
            "aria-label": "Actions",
            hidden: !binding.snapshot().actionFrame,
          }),
          props,
        ),
      );
    },
  });
}

export function ActionsTrigger(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const { controller, snapshot } = useCmdflow();
  return element(
    "button",
    reactiveProps(() => controller.getActionsTriggerProps(snapshot()), props),
  );
}
export function Close(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const { controller, snapshot } = useCmdflow();
  return element(
    "button",
    reactiveProps(() => controller.getCloseProps(snapshot()), props),
  );
}
export function Back(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & SurfaceProps,
): JSX.Element {
  const [local, consumer] = splitProps(props, ["surface"]);
  const inherited = useContext(SurfaceContext);
  const { controller, snapshot } = useCmdflow();
  return element(
    "button",
    reactiveProps(() => controller.getBackProps(local.surface ?? inherited, snapshot()), consumer),
  );
}

export function Form(props: JSX.FormHTMLAttributes<HTMLFormElement> & SurfaceProps): JSX.Element {
  const [local, consumer] = splitProps(props, ["surface"]);
  const inherited = useContext(SurfaceContext);
  const { controller, snapshot } = useCmdflow();
  const address = createAddress(() => local.surface ?? inherited);
  return element(
    "form",
    reactiveProps(
      () => ({
        noValidate: true,
        ...controller.getFormProps(local.surface ?? inherited, snapshot()),
      }),
      consumer,
      (el) => controller.bindForm(el as HTMLFormElement, address()),
    ),
  );
}

export type FieldProps = JSX.InputHTMLAttributes<HTMLInputElement> &
  SurfaceProps & { fieldId: string };
export function createFieldProps(props: FieldProps): JSX.InputHTMLAttributes<HTMLInputElement> {
  const [local, consumer] = splitProps(props, ["surface", "fieldId"]);
  const inherited = useContext(SurfaceContext);
  const { controller, snapshot } = useCmdflow();
  const address = createAddress(() => local.surface ?? inherited);
  return reactiveProps(
    () => controller.getFieldProps(local.fieldId, local.surface ?? inherited, snapshot()),
    consumer,
    (el) => controller.bindField(local.fieldId, el as HTMLInputElement, address()),
  );
}
export function Field(props: FieldProps): JSX.Element {
  return element("input", createFieldProps(props) as Props);
}

type NamedField = SurfaceProps & { fieldId: string };
function fieldControl(component: "textarea" | "select", props: NamedField & object): JSX.Element {
  const [local, consumer] = splitProps(props as NamedField & Props, ["surface", "fieldId"]);
  const inherited = useContext(SurfaceContext);
  const { controller, snapshot } = useCmdflow();
  const address = createAddress(() => local.surface ?? inherited);
  const options = createMemo(
    () =>
      frameFor(snapshot(), local.surface ?? inherited)?.view.fields.find(
        (field) => field.id === local.fieldId,
      )?.options,
  );
  const children = createMemo(() =>
    component === "select"
      ? options()?.map((option) =>
          element("option", { value: option.value, children: option.label }),
        )
      : undefined,
  );
  return element(
    component,
    reactiveProps(
      () => ({
        children: children(),
        ...controller.getFieldProps(local.fieldId, local.surface ?? inherited, snapshot()),
      }),
      consumer,
      (el) =>
        controller.bindField(
          local.fieldId,
          el as HTMLSelectElement | HTMLTextAreaElement,
          address(),
        ),
    ),
  );
}
export function Textarea(
  props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement> & NamedField,
): JSX.Element {
  return fieldControl("textarea", props);
}
export function Select(
  props: JSX.SelectHTMLAttributes<HTMLSelectElement> & NamedField,
): JSX.Element {
  return fieldControl("select", props);
}
export function FieldLabel(
  props: JSX.LabelHTMLAttributes<HTMLLabelElement> & NamedField,
): JSX.Element {
  const [local, consumer] = splitProps(props, ["surface", "fieldId"]);
  const inherited = useContext(SurfaceContext);
  const { controller, snapshot } = useCmdflow();
  return element(
    "label",
    reactiveProps(() => {
      const field = controller.getFieldProps(local.fieldId, local.surface ?? inherited, snapshot());
      return { for: field.id, children: field["aria-label"] };
    }, consumer),
  );
}
export function FieldError(
  props: JSX.HTMLAttributes<HTMLParagraphElement> & NamedField,
): JSX.Element {
  const [local, consumer] = splitProps(props, ["surface", "fieldId"]);
  const inherited = useContext(SurfaceContext);
  const { controller, snapshot } = useCmdflow();
  return element(
    "p",
    reactiveProps(() => {
      const error = frameFor(snapshot(), local.surface ?? inherited)?.form.errors[local.fieldId];
      return {
        ...controller.getFieldErrorProps(local.fieldId, local.surface ?? inherited, snapshot()),
        children: error,
        hidden: !error,
      };
    }, consumer),
  );
}
export function Trigger(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const store = useCmdflowStore();
  return element(
    "button",
    reactiveProps(
      () => ({ type: "button", "aria-haspopup": "dialog", onClick: () => store.open() }),
      props,
    ),
  );
}
export function Confirm(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const store = useCmdflowStore();
  return element(
    "button",
    reactiveProps(
      () => ({
        type: "button",
        onClick: () => {
          void store.confirm();
        },
      }),
      props,
    ),
  );
}
export function CancelConfirmation(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement>,
): JSX.Element {
  const store = useCmdflowStore();
  return element(
    "button",
    reactiveProps(() => ({ type: "button", onClick: () => store.cancelConfirmation() }), props),
  );
}

export function Status(props: JSX.HTMLAttributes<HTMLDivElement>): JSX.Element {
  const { controller, snapshot } = useCmdflow();
  return element(
    "div",
    reactiveProps(
      () => controller.getStatusProps(snapshot()),
      props,
      (el) => controller.bindStatus(el),
    ),
  );
}
export function Confirmation(props: JSX.HTMLAttributes<HTMLDivElement>): JSX.Element {
  const { controller, snapshot } = useCmdflow();
  return element(
    "div",
    reactiveProps(
      () => ({
        ...controller.getConfirmationProps(snapshot()),
        hidden: snapshot().confirmation === null,
      }),
      props,
      (el) => controller.bindConfirmation(el),
    ),
  );
}

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
