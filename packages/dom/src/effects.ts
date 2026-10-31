import type { CmdFlowFrameSnapshot } from "@cmdflow/core";
import type { ElementRegistry } from "./element-registry.js";
import { focusElement } from "./focus.js";
import type { DomIds } from "./ids.js";
import type { VisuallyHiddenStyle } from "./types.js";

/** Required independently of optional reset/preset CSS. */
export const visuallyHiddenStyle: VisuallyHiddenStyle = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: "0",
  margin: "-1px",
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: "0",
};

export interface DomEffects {
  setModality(modality: "keyboard" | "pointer"): void;
  announce(message: string, delay?: number): void;
  clearStatus(): void;
  cancelAnnouncements(): void;
  focusInitial(frame: CmdFlowFrameSnapshot): void;
  scrollActive(frame: CmdFlowFrameSnapshot): void;
  restoreScroll(frame: CmdFlowFrameSnapshot): boolean;
}

export function createDomEffects(
  ids: DomIds,
  elements: ElementRegistry,
  isDestroyed: () => boolean,
): DomEffects {
  let modality: "keyboard" | "pointer" = "keyboard";
  let announcementTimer: ReturnType<typeof setTimeout> | undefined;

  function cancelAnnouncements(): void {
    if (announcementTimer !== undefined) clearTimeout(announcementTimer);
    announcementTimer = undefined;
  }

  return {
    setModality(next) {
      modality = next;
    },
    announce(message, delay = 0) {
      cancelAnnouncements();
      if (delay === 0) {
        if (elements.status) elements.status.textContent = message;
        return;
      }
      announcementTimer = setTimeout(() => {
        if (!isDestroyed() && elements.status) elements.status.textContent = message;
      }, delay);
    },
    clearStatus() {
      if (elements.status) elements.status.textContent = "";
    },
    cancelAnnouncements,
    focusInitial(frame) {
      const address = { surface: frame.surface, frameId: frame.id };
      if (frame.view.type === "form") {
        const invalid = Object.keys(frame.form.errors)[0];
        const first = frame.view.fields[0]?.id;
        if (invalid && focusElement(elements.fields.get(`${ids.addressKey(address)}:${invalid}`)))
          return;
        if (first && focusElement(elements.fields.get(`${ids.addressKey(address)}:${first}`)))
          return;
        if (focusElement(elements.forms.get(ids.addressKey(address)))) return;
      }
      if (!focusElement(elements.inputs.get(ids.addressKey(address))))
        focusElement(elements.dialog);
    },
    scrollActive(frame) {
      if (modality === "pointer") return;
      const address = { surface: frame.surface, frameId: frame.id };
      const viewport = elements.lists.get(ids.addressKey(address));
      const active = frame.activeId
        ? elements.items.get(ids.itemKey(frame.activeId, address))
        : undefined;
      if (!viewport || !active?.isConnected) return;
      const box = viewport.getBoundingClientRect();
      const row = active.getBoundingClientRect();
      if (row.top < box.top) viewport.scrollTop += row.top - box.top;
      else if (row.bottom > box.bottom) viewport.scrollTop += row.bottom - box.bottom;
    },
    restoreScroll(frame) {
      if (!frame.scrollAnchor) return false;
      const address = { surface: frame.surface, frameId: frame.id };
      const viewport = elements.lists.get(ids.addressKey(address));
      const anchor = elements.items.get(ids.itemKey(frame.scrollAnchor.candidateId, address));
      if (!viewport || !anchor?.isConnected) return false;
      viewport.scrollTop +=
        anchor.getBoundingClientRect().top -
        viewport.getBoundingClientRect().top -
        frame.scrollAnchor.offset;
      return true;
    },
  };
}
