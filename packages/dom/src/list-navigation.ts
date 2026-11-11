import type { CandidateId, CmdFlowFrameSnapshot } from "@cmdflow/core";

export type ListDirection = -1 | 1;

export function pageTarget(
  frame: CmdFlowFrameSnapshot,
  direction: ListDirection,
  viewport: HTMLElement | undefined,
  itemElement: (id: CandidateId) => HTMLElement | undefined,
): CandidateId | undefined {
  const { items, activeId } = frame;
  const activeIndex = items.findIndex((item) => item.candidateId === activeId);
  const active = items[activeIndex];
  if (!active) return items[direction === 1 ? 0 : items.length - 1]?.candidateId;

  const adjacent = items[activeIndex + direction];
  if (!adjacent) return active.candidateId;

  const activeElement = itemElement(active.candidateId);
  if (!viewport?.clientHeight || !activeElement || !viewport.contains(activeElement))
    return adjacent.candidateId;

  const viewportHeight = viewport.clientHeight;
  const origin = activeElement.getBoundingClientRect();
  if (origin.height <= 0) return adjacent.candidateId;

  let target = adjacent.candidateId;
  let measuredIndex = activeIndex;
  let measuredDistance = 0;
  let rowStride = origin.height;

  for (
    let index = activeIndex + direction;
    index >= 0 && index < items.length;
    index += direction
  ) {
    const item = items[index];
    if (!item) break;
    const element = itemElement(item.candidateId);
    const row = element && viewport.contains(element) ? element.getBoundingClientRect() : undefined;
    const rowsFromMeasurement = Math.abs(index - measuredIndex);
    // Virtualized rows may be unmounted. Estimate their positions from the measured row spacing.
    let distance = measuredDistance + rowsFromMeasurement * rowStride;
    if (row && row.height > 0) {
      const measured = (row.top - origin.top) * direction;
      if (measured > measuredDistance) {
        rowStride = (measured - measuredDistance) / rowsFromMeasurement;
        measuredIndex = index;
        measuredDistance = measured;
        distance = measured;
      }
    }
    if (distance > viewportHeight) break;
    target = item.candidateId;
  }

  return target;
}

export function sectionTarget(
  frame: CmdFlowFrameSnapshot,
  direction: ListDirection,
): CandidateId | undefined {
  const { items, activeId } = frame;
  const activeIndex = items.findIndex((item) => item.candidateId === activeId);
  const active = items[activeIndex];
  if (!active) return items[0]?.candidateId;

  let index = activeIndex + direction;
  while (items[index] && items[index]?.section === active.section) index += direction;
  const adjacent = items[index];
  if (!adjacent) return;

  if (direction === -1) {
    while (index > 0 && items[index - 1]?.section === adjacent.section) index -= 1;
  }
  return items[index]?.candidateId;
}
