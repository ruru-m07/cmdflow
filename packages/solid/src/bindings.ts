import {
  createComponent,
  createMemo,
  createRenderEffect,
  createSignal,
  type JSX,
  onCleanup,
  splitProps,
} from "solid-js";
import { Dynamic } from "solid-js/web";

import { type ElementProps, mergeProps } from "./merge-props.js";

export type ElementBinding<Element> = (element: Element) => () => void;

function callConsumerRef<Element>(ref: unknown, element: Element): (() => void) | undefined {
  if (typeof ref !== "function") return undefined;
  const cleanup = ref(element);
  return typeof cleanup === "function" ? cleanup : undefined;
}

/** Build a reactive Solid prop object and keep native element bindings current. */
export function createBoundProps<Element extends HTMLElement>(
  internal: () => ElementProps,
  input: object,
  binding?: ElementBinding<Element>,
): ElementProps {
  const [local, consumer] = splitProps(input as ElementProps, ["children", "ref"]);
  const children = createMemo(() => local.children);
  const combined = createMemo(() => {
    const props = mergeProps(internal(), consumer);
    const content = children();
    if (content !== undefined) props.children = content;
    return props;
  });
  const [mountedElement, setMountedElement] = createSignal<Element>();

  createRenderEffect(() => {
    const element = mountedElement();
    if (element && binding) onCleanup(binding(element));
  });

  let consumerCleanup: (() => void) | undefined;
  onCleanup(() => consumerCleanup?.());

  const ref = (element: Element): void => {
    setMountedElement(() => element);
    consumerCleanup?.();
    consumerCleanup = callConsumerRef(local.ref, element);
  };

  return new Proxy(
    {},
    {
      get: (_, key) => (key === "ref" ? ref : combined()[key as string]),
      has: (_, key) => key === "ref" || key in combined(),
      ownKeys: () => [...new Set([...Reflect.ownKeys(combined()), "ref"])],
      getOwnPropertyDescriptor: (_, key) => ({
        enumerable: true,
        configurable: true,
        get: () => (key === "ref" ? ref : combined()[key as string]),
      }),
    },
  );
}

export function renderElement(
  component: keyof JSX.IntrinsicElements,
  props: ElementProps,
): JSX.Element {
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
