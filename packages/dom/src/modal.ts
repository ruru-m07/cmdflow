import { isHtmlElement } from "./focus.js";

type Restore = () => void;

const inertOwners = new WeakMap<HTMLElement, { count: number; previous: boolean }>();

function makeOutsideInert(container: HTMLElement): Restore {
  const changed: HTMLElement[] = [];
  let child = container;
  for (;;) {
    const parent = child.parentNode;
    if (!parent) break;
    if ("children" in parent) {
      for (const sibling of (parent as ParentNode).children) {
        if (sibling === child || !isHtmlElement(sibling)) continue;
        const owner = inertOwners.get(sibling) ?? { count: 0, previous: sibling.inert };
        owner.count += 1;
        inertOwners.set(sibling, owner);
        sibling.inert = true;
        changed.push(sibling);
      }
    }
    if (isHtmlElement(parent)) child = parent;
    else if ("host" in parent && isHtmlElement(parent.host)) child = parent.host;
    else break;
  }
  return () => {
    for (const element of changed) {
      const owner = inertOwners.get(element);
      if (!owner) continue;
      owner.count -= 1;
      if (owner.count === 0) {
        element.inert = owner.previous;
        inertOwners.delete(element);
      }
    }
  };
}

export function isNativeDialog(element: HTMLElement): element is HTMLDialogElement {
  return (
    element.tagName === "DIALOG" &&
    "showModal" in element &&
    typeof element.showModal === "function"
  );
}

export interface ModalController {
  readonly nativeClosing: boolean;
  syncDialog(dialog: HTMLElement, open: boolean): void;
  activateConfirmation(confirmation: HTMLElement): void;
  releaseConfirmation(): void;
  releaseDialog(dialog: HTMLElement): void;
}

export function createModalController(): ModalController {
  let restoreOutside: Restore | undefined;
  let restoreConfirmationOutside: Restore | undefined;
  let nativeClosing = false;

  function releaseOutside(): void {
    restoreOutside?.();
    restoreOutside = undefined;
  }

  function releaseConfirmation(): void {
    restoreConfirmationOutside?.();
    restoreConfirmationOutside = undefined;
  }

  function closeNative(dialog: HTMLDialogElement): void {
    if (!dialog.open) return;
    nativeClosing = true;
    dialog.close();
    nativeClosing = false;
  }

  return {
    get nativeClosing() {
      return nativeClosing;
    },
    syncDialog(dialog, open) {
      if (isNativeDialog(dialog)) {
        if (open && !dialog.open && dialog.isConnected) dialog.showModal();
        else if (!open) closeNative(dialog);
        return;
      }
      dialog.hidden = !open;
      if (open && !restoreOutside) restoreOutside = makeOutsideInert(dialog);
      else if (!open) releaseOutside();
    },
    activateConfirmation(confirmation) {
      if (!restoreConfirmationOutside) restoreConfirmationOutside = makeOutsideInert(confirmation);
    },
    releaseConfirmation,
    releaseDialog(dialog) {
      releaseOutside();
      releaseConfirmation();
      if (isNativeDialog(dialog)) closeNative(dialog);
    },
  };
}
