"use client";

import { createElement, type ReactElement } from "react";

export type PrimitiveRender<Props extends object> = (props: Props) => ReactElement | null;

export function renderPrimitive<Props extends object>(
  element: string,
  props: Props,
  render?: PrimitiveRender<Props>,
): ReactElement | null {
  return render ? render(props) : createElement(element, props);
}
