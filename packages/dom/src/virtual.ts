export interface VirtualRangeOptions {
  readonly count: number;
  readonly scrollTop: number;
  readonly viewportHeight: number;
  readonly rowHeight: number;
  readonly overscan?: number;
  readonly activeIndex?: number;
}

/** Fixed-height virtualization with an always-mounted active option, in logical DOM order. */
export function getVirtualRange(options: VirtualRangeOptions) {
  const count = Number.isFinite(options.count) ? Math.max(0, Math.floor(options.count)) : 0;
  const height =
    Number.isFinite(options.rowHeight) && options.rowHeight > 0 ? options.rowHeight : 1;
  const overscan = Number.isFinite(options.overscan)
    ? Math.max(0, Math.floor(options.overscan ?? 3))
    : 3;
  const scrollTop = Number.isFinite(options.scrollTop) ? Math.max(0, options.scrollTop) : 0;
  const viewportHeight = Number.isFinite(options.viewportHeight)
    ? Math.max(0, options.viewportHeight)
    : 0;
  const start = Math.max(0, Math.min(count, Math.floor(scrollTop / height) - overscan));
  const end = Math.max(
    start,
    Math.min(count, Math.ceil((scrollTop + viewportHeight) / height) + overscan),
  );
  const indexes = new Set<number>();
  for (let index = start; index < end; index += 1) indexes.add(index);
  const active = options.activeIndex;
  if (active !== undefined && Number.isInteger(active) && active >= 0 && active < count)
    indexes.add(active);
  return {
    indexes: [...indexes].sort((a, b) => a - b),
    totalHeight: count * height,
    offsetFor: (index: number) => index * height,
  };
}
