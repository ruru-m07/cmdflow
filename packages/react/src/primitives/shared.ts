import type { CmdFlowSurface } from "@cmdflow/core";

export interface SurfaceProps {
  readonly surface?: CmdFlowSurface;
}

export type BindingRef<Element> = (element: Element | null) => void;
export type BoundProps<Element, Props> = Props & { readonly ref: BindingRef<Element> };
