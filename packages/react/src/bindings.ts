import { type Ref, useCallback, useMemo, useRef } from "react";

import { composeRefs } from "./merge-props.js";

export type ElementBinding<Element> = (element: Element) => () => void;

export function useElementBinding<Element>(
  bind: ElementBinding<Element>,
  forwardedRef?: Ref<Element>,
): (element: Element | null) => void {
  const cleanup = useRef<(() => void) | undefined>(undefined);
  const bindingRef = useCallback(
    (element: Element | null) => {
      cleanup.current?.();
      cleanup.current = element ? bind(element) : undefined;
    },
    [bind],
  );

  return useMemo(() => composeRefs(bindingRef, forwardedRef), [bindingRef, forwardedRef]);
}
