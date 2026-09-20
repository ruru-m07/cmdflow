export function eventTarget(event: Event): EventTarget | null {
  return event.composedPath?.()[0] ?? event.target;
}

export function isHtmlElement(value: unknown): value is HTMLElement {
  return typeof value === "object" && value !== null && "nodeType" in value && value.nodeType === 1;
}

export function isEditableElement(value: unknown): boolean {
  return (
    isHtmlElement(value) &&
    (["INPUT", "TEXTAREA", "SELECT"].includes(value.tagName) ||
      value.isContentEditable ||
      value.closest('[contenteditable="true"]') !== null)
  );
}

export function getDeepActiveElement(scope: Document | ShadowRoot): HTMLElement | null {
  let active = scope.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return isHtmlElement(active) ? active : null;
}

function composedParent(element: HTMLElement): HTMLElement | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return "host" in root && isHtmlElement(root.host) ? root.host : null;
}

export function isValidFocusTarget(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected || typeof element.focus !== "function") return false;
  if (element.matches(":disabled")) return false;
  let ancestor: HTMLElement | null = element;
  while (ancestor) {
    const style = ancestor.ownerDocument.defaultView?.getComputedStyle(ancestor);
    if (
      ancestor.hidden ||
      ancestor.inert ||
      style?.display === "none" ||
      style?.visibility === "hidden"
    )
      return false;
    ancestor = composedParent(ancestor);
  }
  return element.tabIndex >= 0 || element.hasAttribute("tabindex") || isEditableElement(element);
}

export function focusElement(element: HTMLElement | null | undefined): boolean {
  if (!element || !isValidFocusTarget(element)) return false;
  element.focus({ preventScroll: true });
  return true;
}

export function trapTabFocus(
  event: KeyboardEvent,
  container: HTMLElement,
  activeElement: Element | null | undefined,
  wrapForwardFromContainer = false,
): void {
  const controls = [
    ...container.querySelectorAll<HTMLElement>("input,textarea,select,button,a[href],[tabindex]"),
  ].filter((element) => isValidFocusTarget(element) && element.tabIndex >= 0);
  const first = controls[0];
  const last = controls.at(-1);
  if (!first) {
    event.preventDefault();
    focusElement(container);
  } else if (event.shiftKey && (activeElement === first || activeElement === container)) {
    event.preventDefault();
    focusElement(last);
  } else if (
    !event.shiftKey &&
    (activeElement === last || (wrapForwardFromContainer && activeElement === container))
  ) {
    event.preventDefault();
    focusElement(first);
  }
}
