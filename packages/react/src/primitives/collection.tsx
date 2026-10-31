"use client";

import type {
  CandidateId,
  CmdFlowKeybinding,
  CmdFlowResolvedItem,
  CmdFlowSnapshot,
  CmdFlowSourceSnapshot,
  CmdFlowSurface,
} from "@cmdflow/core";
import {
  type ComponentPropsWithoutRef,
  createContext,
  createElement,
  forwardRef,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
} from "react";

import { useElementBinding } from "../bindings.js";
import { mergeProps } from "../merge-props.js";
import { type PrimitiveRender, renderPrimitive } from "../render.js";
import {
  frameFor,
  indexItems,
  useCmdFlow,
  useCmdFlowSelector,
  useCommandContext,
  useSurface,
} from "../selectors.js";
import type { BoundProps, SurfaceProps } from "./shared.js";

export type InputProps = Omit<ComponentPropsWithoutRef<"input">, "value" | "defaultValue"> &
  SurfaceProps;

interface InputState {
  readonly snapshot: CmdFlowSnapshot;
  readonly open: boolean;
  readonly frameId?: string;
  readonly query?: string;
  readonly activeId?: CandidateId | null;
}

function equalInputState(left: InputState, right: InputState): boolean {
  return (
    left.open === right.open &&
    left.frameId === right.frameId &&
    left.query === right.query &&
    left.activeId === right.activeId
  );
}

export function useInputProps(
  props: InputProps = {},
  forwardedRef?: Ref<HTMLInputElement>,
): BoundProps<HTMLInputElement, ComponentPropsWithoutRef<"input">> {
  const {
    surface: requestedSurface,
    value: _value,
    defaultValue: _defaultValue,
    ...consumer
  } = props as ComponentPropsWithoutRef<"input"> & SurfaceProps;
  const surface = useSurface(requestedSurface);
  const { controller } = useCommandContext();
  const selected = useCmdFlowSelector(
    (snapshot): InputState => {
      const frame = frameFor(snapshot, surface);
      return {
        snapshot,
        open: snapshot.open,
        frameId: frame?.id,
        query: frame?.query,
        activeId: frame?.activeId,
      };
    },
    undefined,
    equalInputState,
  );
  const bind = useCallback(
    (element: HTMLInputElement) =>
      controller.bindInput(
        element,
        selected.frameId ? { surface, frameId: selected.frameId } : surface,
      ),
    [controller, selected.frameId, surface],
  );
  const ref = useElementBinding(bind, forwardedRef);
  return {
    ...mergeProps(controller.getInputProps(surface, selected.snapshot), consumer),
    ref,
  };
}

export const Input = forwardRef<HTMLInputElement, InputProps>((props, ref) =>
  createElement("input", useInputProps(props, ref)),
);
Input.displayName = "Command.Input";

type ListElementProps = BoundProps<HTMLDivElement, ComponentPropsWithoutRef<"div">>;

export type ListProps = Omit<ComponentPropsWithoutRef<"div">, "children"> &
  SurfaceProps & {
    readonly children?: ReactNode | ((item: CmdFlowResolvedItem, index: number) => ReactNode);
    readonly render?: PrimitiveRender<ListElementProps>;
  };

interface ListState {
  readonly snapshot: CmdFlowSnapshot;
  readonly items?: readonly CmdFlowResolvedItem[];
  readonly frameId?: string;
  readonly title?: string;
  readonly selectionMode?: "none" | "single" | "multiple";
  readonly loading: boolean;
}

function equalListState(left: ListState, right: ListState): boolean {
  return (
    left.items === right.items &&
    left.frameId === right.frameId &&
    left.title === right.title &&
    left.selectionMode === right.selectionMode &&
    left.loading === right.loading
  );
}

interface ListBindingResult {
  readonly props: ListElementProps;
  readonly items?: readonly CmdFlowResolvedItem[];
}

function useListBinding(props: ListProps, forwardedRef?: Ref<HTMLDivElement>): ListBindingResult {
  const { surface: requestedSurface, children: _children, render: _render, ...consumer } = props;
  const surface = useSurface(requestedSurface);
  const { controller } = useCommandContext();
  const selected = useCmdFlowSelector(
    (snapshot): ListState => {
      const frame = frameFor(snapshot, surface);
      return {
        snapshot,
        items: frame?.items,
        frameId: frame?.id,
        title: frame?.view.title,
        selectionMode: frame?.view.selectionMode,
        loading: frame?.sources.some((source) => source.status === "loading") ?? false,
      };
    },
    undefined,
    equalListState,
  );
  const bind = useCallback(
    (element: HTMLDivElement) =>
      controller.bindList(
        element,
        selected.frameId ? { surface, frameId: selected.frameId } : surface,
      ),
    [controller, selected.frameId, surface],
  );
  const ref = useElementBinding(bind, forwardedRef);
  return {
    props: {
      ...mergeProps(controller.getListProps(surface, selected.snapshot), consumer),
      ref,
    },
    items: selected.items,
  };
}

export function useListProps(
  props: Omit<ListProps, "children" | "render"> = {},
  forwardedRef?: Ref<HTMLDivElement>,
): ListElementProps {
  return useListBinding(props, forwardedRef).props;
}

export const List = forwardRef<HTMLDivElement, ListProps>((props, forwardedRef) => {
  const binding = useListBinding(props, forwardedRef);
  const children =
    typeof props.children === "function" ? binding.items?.map(props.children) : props.children;
  return renderPrimitive("div", { ...binding.props, children }, props.render);
});
List.displayName = "Command.List";

type ItemElementProps = BoundProps<HTMLDivElement, ComponentPropsWithoutRef<"div">>;

export type ItemProps = ComponentPropsWithoutRef<"div"> &
  SurfaceProps & {
    readonly item: CmdFlowResolvedItem | CandidateId;
    readonly render?: PrimitiveRender<ItemElementProps>;
  };

interface ItemState {
  readonly snapshot: CmdFlowSnapshot;
  readonly frameId?: string;
  readonly item?: CmdFlowResolvedItem;
  readonly index: number;
  readonly count: number;
  readonly active: boolean;
  readonly selected: boolean;
  readonly selectionMode?: "none" | "single" | "multiple";
  readonly incomplete: boolean;
}

function equalItemState(left: ItemState, right: ItemState): boolean {
  return (
    left.frameId === right.frameId &&
    left.item === right.item &&
    left.index === right.index &&
    left.count === right.count &&
    left.active === right.active &&
    left.selected === right.selected &&
    left.selectionMode === right.selectionMode &&
    left.incomplete === right.incomplete
  );
}

interface ItemContextValue {
  readonly item?: CmdFlowResolvedItem;
  readonly active: boolean;
  readonly selected: boolean;
}

const ItemContext = createContext<ItemContextValue | null>(null);

interface ItemBindingResult {
  readonly props: ItemElementProps;
  readonly context: ItemContextValue;
}

function useItemBinding(props: ItemProps, forwardedRef?: Ref<HTMLDivElement>): ItemBindingResult {
  const { item: suppliedItem, surface: requestedSurface, render: _render, ...consumer } = props;
  const surface = useSurface(requestedSurface);
  const id = typeof suppliedItem === "string" ? suppliedItem : suppliedItem.candidateId;
  const { controller } = useCommandContext();
  const selected = useCmdFlowSelector(
    (snapshot): ItemState => {
      const frame = frameFor(snapshot, surface);
      const lookup = frame ? indexItems(frame.items).get(id) : undefined;
      return {
        snapshot,
        frameId: frame?.id,
        item: lookup?.item ?? (typeof suppliedItem === "string" ? undefined : suppliedItem),
        index: lookup?.index ?? -1,
        count: frame?.items.length ?? 0,
        active: frame?.activeId === id,
        selected: frame?.selectedIds.includes(id) ?? false,
        selectionMode: frame?.view.selectionMode,
        incomplete:
          frame?.sources.some(
            (source) => source.status === "loading" || source.nextCursor !== undefined,
          ) ?? false,
      };
    },
    undefined,
    equalItemState,
  );
  const bind = useCallback(
    (element: HTMLDivElement) =>
      controller.registerItem(
        id,
        element,
        selected.frameId ? { surface, frameId: selected.frameId } : surface,
      ),
    [controller, id, selected.frameId, surface],
  );
  const ref = useElementBinding(bind, forwardedRef);
  return {
    props: {
      ...mergeProps(controller.getItemProps(id, surface, selected.snapshot), {
        children: selected.item?.title,
        ...consumer,
      }),
      ref,
    },
    context: {
      item: selected.item,
      active: selected.active,
      selected: selected.selected,
    },
  };
}

export function useItemProps(
  props: ItemProps,
  forwardedRef?: Ref<HTMLDivElement>,
): ItemElementProps {
  return useItemBinding(props, forwardedRef).props;
}

export const Item = forwardRef<HTMLDivElement, ItemProps>((props, ref) => {
  const binding = useItemBinding(props, ref);
  return createElement(
    ItemContext.Provider,
    { value: binding.context },
    renderPrimitive("div", binding.props, props.render),
  );
});
Item.displayName = "Command.Item";

const groupIndexes = new WeakMap<object, ReadonlyMap<string, number>>();

function groupCounts(items: readonly CmdFlowResolvedItem[]): ReadonlyMap<string, number> {
  const cached = groupIndexes.get(items);
  if (cached) return cached;
  const counts = new Map<string, number>();
  for (const item of items) {
    const group = item.section ?? "";
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  groupIndexes.set(items, counts);
  return counts;
}

export type GroupProps = Omit<ComponentPropsWithoutRef<"div">, "children"> &
  SurfaceProps & {
    readonly label: string;
    readonly forceMount?: boolean;
    readonly children?: ReactNode | ((state: { readonly count: number }) => ReactNode);
  };

export const Group = forwardRef<HTMLDivElement, GroupProps>((props, ref) => {
  const { label, surface: requestedSurface, forceMount = false, children, ...consumer } = props;
  const surface = useSurface(requestedSurface);
  const { controller } = useCommandContext();
  const selected = useCmdFlowSelector(
    (snapshot) => {
      const frame = frameFor(snapshot, surface);
      return { snapshot, frameId: frame?.id, items: frame?.items };
    },
    undefined,
    (left, right) => left.frameId === right.frameId && left.items === right.items,
  );
  const count = selected.items ? (groupCounts(selected.items).get(label) ?? 0) : 0;
  const visible = count > 0;
  return createElement(
    "div",
    {
      ...mergeProps(controller.getGroupProps(label, surface, selected.snapshot), {
        ...consumer,
        "data-state": visible ? "populated" : "empty",
        "data-cmdflow-count": count,
        hidden: !forceMount && !visible,
      }),
      ref,
    },
    typeof children === "function" ? children({ count }) : children,
  );
});
Group.displayName = "Command.Group";

const EMPTY_ITEMS: readonly CmdFlowResolvedItem[] = [];
const EMPTY_SOURCES: readonly CmdFlowSourceSnapshot[] = [];

interface FrameStatus {
  readonly items: readonly CmdFlowResolvedItem[];
  readonly sources: readonly CmdFlowSourceSnapshot[];
}

function useFrameStatus(surface?: CmdFlowSurface): FrameStatus {
  const resolvedSurface = useSurface(surface);
  return useCmdFlowSelector(
    (snapshot): FrameStatus => {
      const frame = frameFor(snapshot, resolvedSurface);
      return { items: frame?.items ?? EMPTY_ITEMS, sources: frame?.sources ?? EMPTY_SOURCES };
    },
    undefined,
    (left, right) => left.items === right.items && left.sources === right.sources,
  );
}

type StateProps = Omit<ComponentPropsWithoutRef<"div">, "children"> &
  SurfaceProps & {
    readonly forceMount?: boolean;
    readonly children?: ReactNode;
  };

export const Empty = forwardRef<HTMLDivElement, StateProps>((props, ref) => {
  const { surface, forceMount = false, ...consumer } = props;
  const state = useFrameStatus(surface);
  const loading = state.sources.some((source) => source.status === "loading");
  const failed = state.sources.some((source) => source.status === "error");
  const visible = state.items.length === 0 && !loading && !failed;
  return createElement("div", {
    ...consumer,
    ref,
    "data-cmdflow-part": "empty",
    "data-state": visible ? "visible" : "hidden",
    hidden: !forceMount && !visible,
  });
});
Empty.displayName = "Command.Empty";

export type LoadingProps = Omit<StateProps, "children"> & {
  readonly children?: ReactNode | ((sources: readonly CmdFlowSourceSnapshot[]) => ReactNode);
};

export const Loading = forwardRef<HTMLDivElement, LoadingProps>((props, ref) => {
  const { surface, forceMount = false, children, ...consumer } = props;
  const state = useFrameStatus(surface);
  const sources = state.sources.filter((source) => source.status === "loading");
  const visible = sources.length > 0;
  return createElement(
    "div",
    {
      ...consumer,
      ref,
      role: consumer.role ?? "status",
      "data-cmdflow-part": "loading",
      "data-state": visible ? "visible" : "hidden",
      hidden: !forceMount && !visible,
    },
    typeof children === "function" ? children(sources) : children,
  );
});
Loading.displayName = "Command.Loading";

export type ErrorProps = Omit<StateProps, "children"> & {
  readonly children?: ReactNode | ((sources: readonly CmdFlowSourceSnapshot[]) => ReactNode);
};

const ErrorPrimitive = forwardRef<HTMLDivElement, ErrorProps>((props, ref) => {
  const { surface, forceMount = false, children, ...consumer } = props;
  const state = useFrameStatus(surface);
  const sources = state.sources.filter((source) => source.status === "error");
  const visible = sources.length > 0;
  return createElement(
    "div",
    {
      ...consumer,
      ref,
      role: consumer.role ?? "alert",
      "data-cmdflow-part": "error",
      "data-state": visible ? "visible" : "hidden",
      hidden: !forceMount && !visible,
    },
    typeof children === "function"
      ? children(sources)
      : (children ??
          sources
            .map((source) => source.error)
            .filter(Boolean)
            .join(" ")),
  );
});
ErrorPrimitive.displayName = "Command.Error";

export { ErrorPrimitive as Error };

export type LoadMoreProps = ComponentPropsWithoutRef<"button"> &
  SurfaceProps & { readonly sourceId?: string; readonly forceMount?: boolean };

export const LoadMore = forwardRef<HTMLButtonElement, LoadMoreProps>((props, ref) => {
  const { surface: requestedSurface, sourceId, forceMount = false, ...consumer } = props;
  const surface = useSurface(requestedSurface);
  const flow = useCmdFlow();
  const selected = useCmdFlowSelector(
    (snapshot) => {
      const frame = frameFor(snapshot, surface);
      const source = sourceId
        ? frame?.sources.find((candidate) => candidate.id === sourceId)
        : frame?.sources.find((candidate) => candidate.nextCursor !== undefined);
      return { frameId: frame?.id, source };
    },
    undefined,
    (left, right) => left.frameId === right.frameId && left.source === right.source,
  );
  const available = selected.source?.nextCursor !== undefined;
  const loading = selected.source?.status === "loading";
  const internal = {
    type: "button" as const,
    "data-cmdflow-part": "load-more",
    "data-state": loading ? "loading" : available ? "available" : "unavailable",
    hidden: !forceMount && !available,
    disabled: consumer.disabled || loading || !available,
    onClick: (event: Event) => {
      if (event.defaultPrevented || !selected.source || !selected.frameId) return;
      void flow.loadMore(selected.source.id, { surface, frameId: selected.frameId });
    },
  };
  return createElement("button", {
    ...mergeProps(internal, consumer),
    ref,
    type: "button",
  });
});
LoadMore.displayName = "Command.LoadMore";

export type SeparatorProps = ComponentPropsWithoutRef<"div"> & SurfaceProps;

export const Separator = forwardRef<HTMLDivElement, SeparatorProps>((props, ref) => {
  const { surface: requestedSurface, ...consumer } = props;
  const surface = useSurface(requestedSurface);
  return createElement("div", {
    ...consumer,
    ref,
    role: consumer.role ?? "separator",
    "data-cmdflow-part": "separator",
    "data-cmdflow-surface": surface,
  });
});
Separator.displayName = "Command.Separator";

function shortcutLabel(shortcut: CmdFlowKeybinding): string {
  return [
    shortcut.mod ? "Mod" : null,
    shortcut.ctrl ? "Control" : null,
    shortcut.meta ? "Meta" : null,
    shortcut.alt ? "Alt" : null,
    shortcut.shift ? "Shift" : null,
    shortcut.key === " " ? "Space" : shortcut.key.toUpperCase(),
  ]
    .filter(Boolean)
    .join("+");
}

export type ShortcutProps = ComponentPropsWithoutRef<"kbd"> & {
  readonly shortcut?: CmdFlowKeybinding | string;
};

export const Shortcut = forwardRef<HTMLElement, ShortcutProps>((props, ref) => {
  const { shortcut: suppliedShortcut, children, ...consumer } = props;
  const item = useContext(ItemContext)?.item;
  let shortcut = suppliedShortcut;
  if (shortcut === undefined) {
    for (const action of item?.actions ?? []) {
      if (action.shortcut && (action.priority === "primary" || shortcut === undefined)) {
        shortcut = action.shortcut;
        if (action.priority === "primary") break;
      }
    }
  }
  const label = typeof shortcut === "string" ? shortcut : shortcut ? shortcutLabel(shortcut) : "";
  return createElement(
    "kbd",
    {
      ...consumer,
      ref,
      "aria-label": consumer["aria-label"] ?? (label || undefined),
      "data-cmdflow-part": "shortcut",
      hidden: children === undefined && !label,
    },
    children ?? label,
  );
});
Shortcut.displayName = "Command.Shortcut";

export type SelectionIndicatorProps = ComponentPropsWithoutRef<"span"> & {
  readonly forceMount?: boolean;
};

export const SelectionIndicator = forwardRef<HTMLSpanElement, SelectionIndicatorProps>(
  (props, ref) => {
    const { forceMount = false, ...consumer } = props;
    const selected = useContext(ItemContext)?.selected ?? false;
    return createElement("span", {
      ...consumer,
      ref,
      "aria-hidden": consumer["aria-hidden"] ?? true,
      "data-cmdflow-part": "selection-indicator",
      "data-state": selected ? "checked" : "unchecked",
      hidden: !forceMount && !selected,
    });
  },
);
SelectionIndicator.displayName = "Command.SelectionIndicator";
