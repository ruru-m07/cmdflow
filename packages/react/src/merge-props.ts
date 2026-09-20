import type { Ref, SyntheticEvent } from "react";

export type ElementProps = Record<string, unknown>;

/** Merge consumer props with CmdFlow's required behavior and accessibility contract. */
export function mergeProps<Internal extends object, Consumer extends object>(
  internal: Internal,
  consumer: Consumer,
): Internal & Consumer {
  const internalProps = internal as ElementProps;
  const consumerProps = consumer as ElementProps;
  const merged: ElementProps = { ...consumerProps, ...internalProps };

  for (const key of Object.keys(internalProps)) {
    if (!/^on[A-Z]/.test(key) || typeof internalProps[key] !== "function") continue;

    const libraryHandler = internalProps[key] as (event: Event) => void;
    const consumerHandler = consumerProps[key] as ((event: SyntheticEvent) => void) | undefined;
    merged[key] = (event: SyntheticEvent) => {
      consumerHandler?.(event);
      if (!event.defaultPrevented) {
        libraryHandler(event.nativeEvent ?? (event as unknown as Event));
      }
    };
  }

  if (consumerProps.className !== undefined) merged.className = consumerProps.className;
  if (consumerProps.style !== undefined) {
    merged.style = { ...(internalProps.style as object), ...(consumerProps.style as object) };
  }

  for (const key of ["aria-label", "aria-labelledby", "aria-describedby"] as const) {
    if (consumerProps[key] === undefined) continue;
    merged[key] =
      key === "aria-describedby" && internalProps[key]
        ? `${consumerProps[key]} ${internalProps[key]}`
        : consumerProps[key];
  }

  return merged as Internal & Consumer;
}

export function composeRefs<Element>(
  ...refs: readonly (Ref<Element> | undefined)[]
): (element: Element | null) => void {
  const cleanups = new Map<Ref<Element>, () => void>();

  return (element) => {
    for (const ref of refs) {
      const previousCleanup = ref ? cleanups.get(ref) : undefined;
      previousCleanup?.();
      if (ref) cleanups.delete(ref);

      if (typeof ref === "function") {
        if (element === null && previousCleanup) continue;
        const cleanup = ref(element);
        if (typeof cleanup === "function") cleanups.set(ref, cleanup);
      } else if (ref) {
        ref.current = element;
      }
    }
  };
}
