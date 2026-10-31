export type ElementProps = Record<string, unknown>;

function callHandler(handler: unknown, event: Event): void {
  if (typeof handler === "function") {
    handler(event);
    return;
  }

  if (Array.isArray(handler) && typeof handler[0] === "function") {
    (handler[0] as (data: unknown, event: Event) => void)(handler[1], event);
  }
}

function cssName(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function styleText(style: unknown): string {
  if (typeof style === "string") return style;
  if (!style || typeof style !== "object") return "";

  return Object.entries(style)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => `${cssName(name)}:${String(value)}`)
    .join(";");
}

function mergeStyles(internal: unknown, consumer: unknown): unknown {
  if (consumer === undefined) return internal;
  if (internal === undefined) return consumer;
  if (typeof internal === "object" && typeof consumer === "object") {
    return { ...(internal as object), ...(consumer as object) };
  }

  return [styleText(internal), styleText(consumer)].filter(Boolean).join(";");
}

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
    const consumerHandler = consumerProps[key] ?? consumerProps[key.toLowerCase()];
    merged[key] = (event: Event) => {
      callHandler(consumerHandler, event);
      if (!event.defaultPrevented) libraryHandler(event);
    };
    delete merged[key.toLowerCase()];
  }

  if (consumerProps.class !== undefined) {
    merged.class = [internalProps.class, consumerProps.class].filter(Boolean).join(" ");
  }
  merged.style = mergeStyles(internalProps.style, consumerProps.style);

  for (const key of ["aria-label", "aria-labelledby", "aria-describedby"] as const) {
    if (consumerProps[key] === undefined) continue;
    merged[key] =
      key === "aria-describedby" && internalProps[key]
        ? `${consumerProps[key]} ${internalProps[key]}`
        : consumerProps[key];
  }

  return merged as Internal & Consumer;
}

// biome-ignore lint/suspicious/noConfusingVoidType: Solid callback refs may return a cleanup or nothing.
export type ElementRef<Element> = (element: Element) => void | (() => void);

/** Compose Solid callback refs while honoring cleanup functions returned by refs. */
export function composeRefs<Element>(
  ...refs: readonly (ElementRef<Element> | undefined)[]
): (element: Element) => void {
  const cleanups = new Map<ElementRef<Element>, () => void>();

  return (element) => {
    for (const ref of refs) {
      if (!ref) continue;
      cleanups.get(ref)?.();
      cleanups.delete(ref);
      const cleanup = ref(element);
      if (typeof cleanup === "function") cleanups.set(ref, cleanup);
    }
  };
}
