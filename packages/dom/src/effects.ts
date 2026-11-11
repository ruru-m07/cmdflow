import type { CmdFlowFrameSnapshot } from "@cmdflow/core";
import type { ElementRegistry } from "./element-registry.js";
import { focusElement } from "./focus.js";
import type { DomIds } from "./ids.js";

export interface DomEffects {
  setModality(modality: "keyboard" | "pointer"): void;
  announce(message: string, delay?: number): void;
  clearStatus(): void;
  cancelAnnouncements(): void;
  focusInitial(frame: CmdFlowFrameSnapshot): void;
  scrollActive(frame: CmdFlowFrameSnapshot): void;
  rememberScroll(frame: CmdFlowFrameSnapshot): CmdFlowFrameSnapshot["scrollAnchor"];
  resetScroll(frame: CmdFlowFrameSnapshot): void;
  restoreScroll(frame: CmdFlowFrameSnapshot): boolean;
  retainScroll(frameIds: ReadonlySet<string>): void;
}

interface ScrollPosition {
  readonly query: string;
  readonly top: number;
  readonly anchor: CmdFlowFrameSnapshot["scrollAnchor"];
}

export function createDomEffects(
  ids: DomIds,
  elements: ElementRegistry,
  isDestroyed: () => boolean,
): DomEffects {
  let modality: "keyboard" | "pointer" = "keyboard";
  let announcementTimer: ReturnType<typeof setTimeout> | undefined;
  const scrollPositions = new Map<string, ScrollPosition>();

  function list(frame: CmdFlowFrameSnapshot): HTMLElement | undefined {
    return elements.lists.get(ids.addressKey({ surface: frame.surface, frameId: frame.id }));
  }

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
      const viewport = list(frame);
      const active = frame.activeId
        ? elements.items.get(ids.itemKey(frame.activeId, address))
        : undefined;
      if (!viewport?.isConnected || !active || !viewport.contains(active)) return;
      const box = viewport.getBoundingClientRect();
      const row = active.getBoundingClientRect();
      if (row.top < box.top) viewport.scrollTop += row.top - box.top;
      else if (row.bottom > box.bottom) viewport.scrollTop += row.bottom - box.bottom;
    },
    rememberScroll(frame) {
      const viewport = list(frame);
      if (!viewport?.isConnected || viewport.getClientRects().length === 0) return null;
      const address = { surface: frame.surface, frameId: frame.id };
      const row = frame.activeId ? elements.items.get(ids.itemKey(frame.activeId, address)) : null;
      const anchor =
        frame.activeId && row && viewport.contains(row)
          ? {
              candidateId: frame.activeId,
              offset: row.getBoundingClientRect().top - viewport.getBoundingClientRect().top,
            }
          : null;
      scrollPositions.set(frame.id, { query: frame.query, top: viewport.scrollTop, anchor });
      return anchor;
    },
    resetScroll(frame) {
      const viewport = list(frame);
      if (viewport) viewport.scrollTop = 0;
      scrollPositions.delete(frame.id);
    },
    restoreScroll(frame) {
      const viewport = list(frame);
      if (!viewport?.isConnected || viewport.getClientRects().length === 0) return false;
      const saved = scrollPositions.get(frame.id);
      const position = saved?.query === frame.query ? saved : undefined;
      const anchor = position?.anchor ?? frame.scrollAnchor;
      const address = { surface: frame.surface, frameId: frame.id };
      const row = anchor ? elements.items.get(ids.itemKey(anchor.candidateId, address)) : undefined;
      if (anchor && row && viewport.contains(row)) {
        viewport.scrollTop +=
          row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.offset;
        return true;
      }
      if (!position) return false;
      viewport.scrollTop = position.top;
      return true;
    },
    retainScroll(frameIds) {
      for (const frameId of scrollPositions.keys())
        if (!frameIds.has(frameId)) scrollPositions.delete(frameId);
    },
  };
}
