import type {
  CandidateId,
  CmdFlowKeybinding,
  CmdFlowResolvedItem,
  CmdFlowSnapshot,
  CmdFlowSourceSnapshot,
} from "@cmdflow/core";
import {
  type Accessor,
  createComponent,
  createContext,
  createMemo,
  For,
  type JSX,
  splitProps,
  useContext,
} from "solid-js";

import { createBoundProps, renderElement } from "../bindings.js";
import { SurfaceContext, useCommandContext } from "../context.js";
import type { ElementProps } from "../merge-props.js";
import {
  createAddress,
  createCmdFlowSelector,
  frameFor,
  indexItems,
  useCmdFlow,
} from "../selectors.js";
import type { SurfaceProps } from "./shared.js";

const EMPTY_ITEMS: readonly CmdFlowResolvedItem[] = [];
const EMPTY_SOURCES: readonly CmdFlowSourceSnapshot[] = [];

function surfaceAccessor(
  requested: Accessor<SurfaceProps["surface"]>,
): Accessor<"main" | "actions"> {
  const inherited = useContext(SurfaceContext);
  return () => requested() ?? inherited;
}

export type InputProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue"> &
  SurfaceProps;

export function createInputProps(
  props: InputProps = {},
): JSX.InputHTMLAttributes<HTMLInputElement> {
  const [local, consumer] = splitProps(
    props as JSX.InputHTMLAttributes<HTMLInputElement> &
      SurfaceProps & {
        readonly defaultValue?: unknown;
      },
    ["surface", "value", "defaultValue"],
  );
  const surface = surfaceAccessor(() => local.surface);
  const { controller, snapshot } = useCommandContext();
  const address = createAddress(surface);

  return createBoundProps<HTMLInputElement>(
    () => controller.getInputProps(surface(), snapshot()) as unknown as ElementProps,
    consumer,
    (element) => controller.bindInput(element, address()),
  ) as JSX.InputHTMLAttributes<HTMLInputElement>;
}

export function Input(props: InputProps): JSX.Element {
  return renderElement("input", createInputProps(props) as ElementProps);
}

export type ListProps<TData = unknown> = Omit<JSX.HTMLAttributes<HTMLDivElement>, "children"> &
  SurfaceProps & {
    readonly children?:
      | JSX.Element
      | ((item: CmdFlowResolvedItem<TData>, index: Accessor<number>) => JSX.Element);
  };

export function List<TData = unknown>(props: ListProps<TData>): JSX.Element {
  const [local, consumer] = splitProps(props, ["surface", "children"]);
  const surface = surfaceAccessor(() => local.surface);
  const { controller, snapshot } = useCommandContext();
  const address = createAddress(surface);
  const items = createMemo(
    () =>
      frameFor(snapshot() as CmdFlowSnapshot<TData>, surface())?.items ??
      (EMPTY_ITEMS as readonly CmdFlowResolvedItem<TData>[]),
  ) as Accessor<readonly CmdFlowResolvedItem<TData>[]>;
  const ids = createMemo(() => items().map((item) => item.candidateId), undefined, {
    equals: (left, right) =>
      left.length === right.length && left.every((id, index) => id === right[index]),
  });
  const itemIndex = createMemo(() => indexItems(items()));
  const renderedItems = createComponent(For, {
    get each() {
      return ids();
    },
    children: (id: CandidateId, position: Accessor<number>) => {
      const resolve = (): CmdFlowResolvedItem<TData> | undefined => itemIndex().byId.get(id)?.item;
      const item = new Proxy({} as CmdFlowResolvedItem<TData>, {
        get: (_, key) => resolve()?.[key as keyof CmdFlowResolvedItem<TData>],
        has: (_, key) => key in (resolve() ?? {}),
        ownKeys: () => Reflect.ownKeys(resolve() ?? {}),
        getOwnPropertyDescriptor: (_, key) => ({
          enumerable: true,
          configurable: true,
          get: () => resolve()?.[key as keyof CmdFlowResolvedItem<TData>],
        }),
      });
      return typeof local.children === "function" ? local.children(item, position) : undefined;
    },
  });

  return renderElement(
    "div",
    createBoundProps<HTMLDivElement>(
      () => ({
        ...(controller.getListProps(surface(), snapshot()) as unknown as ElementProps),
        children: typeof local.children === "function" ? renderedItems : local.children,
      }),
      consumer,
      (element) => controller.bindList(element, address()),
    ),
  );
}

interface ItemContextValue<TData = unknown> {
  readonly item?: CmdFlowResolvedItem<TData>;
  readonly selected: boolean;
}

const ItemContext = createContext<ItemContextValue>();

export type ItemProps<TData = unknown> = JSX.HTMLAttributes<HTMLDivElement> &
  SurfaceProps & { readonly item: CmdFlowResolvedItem<TData> | CandidateId };

interface ItemBinding<TData> {
  readonly props: JSX.HTMLAttributes<HTMLDivElement>;
  readonly context: ItemContextValue<TData>;
}

function createItemBinding<TData>(props: ItemProps<TData>): ItemBinding<TData> {
  const [local, consumer] = splitProps(props, ["surface", "item"]);
  const surface = surfaceAccessor(() => local.surface);
  const { controller, snapshot } = useCommandContext();
  const address = createAddress(surface);
  const id = (): CandidateId =>
    typeof local.item === "string" ? local.item : local.item.candidateId;
  const resolved = (): CmdFlowResolvedItem<TData> | undefined => {
    if (typeof local.item !== "string") return local.item;
    const frame = frameFor(snapshot() as CmdFlowSnapshot<TData>, surface());
    return frame
      ? (indexItems(frame.items).byId.get(id())?.item as CmdFlowResolvedItem<TData>)
      : undefined;
  };
  const selected = (): boolean =>
    frameFor(snapshot() as CmdFlowSnapshot<TData>, surface())?.selectedIds.includes(id()) ?? false;

  return {
    props: createBoundProps<HTMLDivElement>(
      () => ({
        children: resolved()?.title,
        ...(controller.getItemProps(id(), surface(), snapshot()) as unknown as ElementProps),
      }),
      consumer,
      (element) => controller.registerItem(id(), element, address()),
    ) as JSX.HTMLAttributes<HTMLDivElement>,
    context: {
      get item() {
        return resolved();
      },
      get selected() {
        return selected();
      },
    },
  };
}

export function createItemProps<TData = unknown>(
  props: ItemProps<TData>,
): JSX.HTMLAttributes<HTMLDivElement> {
  return createItemBinding(props).props;
}

export function Item<TData = unknown>(props: ItemProps<TData>): JSX.Element {
  const binding = createItemBinding(props);
  return createComponent(ItemContext.Provider, {
    value: binding.context as ItemContextValue,
    get children() {
      return renderElement("div", binding.props as ElementProps);
    },
  });
}

export type GroupProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, "children"> &
  SurfaceProps & {
    readonly label: string;
    readonly forceMount?: boolean;
    readonly children?: JSX.Element | ((state: { readonly count: number }) => JSX.Element);
  };

export function Group(props: GroupProps): JSX.Element {
  const [local, consumer] = splitProps(props, ["surface", "label", "forceMount", "children"]);
  const surface = surfaceAccessor(() => local.surface);
  const { controller, snapshot } = useCommandContext();
  const items = createMemo(() => frameFor(snapshot(), surface())?.items ?? EMPTY_ITEMS);
  const count = createMemo(() => indexItems(items()).groupCounts[local.label] ?? 0);

  return renderElement(
    "div",
    createBoundProps<HTMLDivElement>(() => {
      const visible = count() > 0;
      return {
        ...(controller.getGroupProps(
          local.label,
          surface(),
          snapshot(),
        ) as unknown as ElementProps),
        "data-state": visible ? "populated" : "empty",
        "data-cmdflow-count": count(),
        hidden: !local.forceMount && !visible,
        children:
          typeof local.children === "function"
            ? local.children({ count: count() })
            : local.children,
      };
    }, consumer),
  );
}

interface FrameStatus {
  readonly items: readonly CmdFlowResolvedItem[];
  readonly sources: readonly CmdFlowSourceSnapshot[];
}

function createFrameStatus(
  requestedSurface: Accessor<SurfaceProps["surface"]>,
): Accessor<FrameStatus> {
  const resolvedSurface = surfaceAccessor(requestedSurface);
  return createCmdFlowSelector(
    (snapshot): FrameStatus => {
      const frame = frameFor(snapshot, resolvedSurface());
      return {
        items: frame?.items ?? EMPTY_ITEMS,
        sources: frame?.sources ?? EMPTY_SOURCES,
      };
    },
    undefined,
    (left, right) => left.items === right.items && left.sources === right.sources,
  );
}

type StateProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, "children"> &
  SurfaceProps & {
    readonly forceMount?: boolean;
    readonly children?: JSX.Element;
  };

export function Empty(props: StateProps): JSX.Element {
  const [local, consumer] = splitProps(props, ["surface", "forceMount", "children"]);
  const status = createFrameStatus(() => local.surface);
  return renderElement(
    "div",
    createBoundProps<HTMLDivElement>(() => {
      const loading = status().sources.some((source) => source.status === "loading");
      const failed = status().sources.some((source) => source.status === "error");
      const visible = status().items.length === 0 && !loading && !failed;
      return {
        "data-cmdflow-part": "empty",
        "data-state": visible ? "visible" : "hidden",
        hidden: !local.forceMount && !visible,
        children: local.children,
      };
    }, consumer),
  );
}

export type LoadingProps = Omit<StateProps, "children"> & {
  readonly children?: JSX.Element | ((sources: readonly CmdFlowSourceSnapshot[]) => JSX.Element);
};

export function Loading(props: LoadingProps): JSX.Element {
  const [local, consumer] = splitProps(props, ["surface", "forceMount", "children"]);
  const status = createFrameStatus(() => local.surface);
  const sources = createMemo(() =>
    status().sources.filter((source) => source.status === "loading"),
  );
  return renderElement(
    "div",
    createBoundProps<HTMLDivElement>(
      () => ({
        role: consumer.role ?? "status",
        "data-cmdflow-part": "loading",
        "data-state": sources().length > 0 ? "visible" : "hidden",
        hidden: !local.forceMount && sources().length === 0,
        children: typeof local.children === "function" ? local.children(sources()) : local.children,
      }),
      consumer,
    ),
  );
}

export type ErrorProps = Omit<StateProps, "children"> & {
  readonly children?: JSX.Element | ((sources: readonly CmdFlowSourceSnapshot[]) => JSX.Element);
};

function ErrorPrimitive(props: ErrorProps): JSX.Element {
  const [local, consumer] = splitProps(props, ["surface", "forceMount", "children"]);
  const status = createFrameStatus(() => local.surface);
  const sources = createMemo(() => status().sources.filter((source) => source.status === "error"));
  return renderElement(
    "div",
    createBoundProps<HTMLDivElement>(
      () => ({
        role: consumer.role ?? "alert",
        "data-cmdflow-part": "error",
        "data-state": sources().length > 0 ? "visible" : "hidden",
        hidden: !local.forceMount && sources().length === 0,
        children:
          typeof local.children === "function"
            ? local.children(sources())
            : (local.children ??
              sources()
                .map((source) => source.error)
                .filter(Boolean)
                .join(" ")),
      }),
      consumer,
    ),
  );
}

export { ErrorPrimitive as Error };

export type LoadMoreProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> &
  SurfaceProps & {
    readonly sourceId?: string;
    readonly forceMount?: boolean;
  };

export function LoadMore(props: LoadMoreProps): JSX.Element {
  const [local, consumer] = splitProps(props, ["surface", "sourceId", "forceMount"]);
  const surface = surfaceAccessor(() => local.surface);
  const flow = useCmdFlow();
  const selected = createCmdFlowSelector(
    (snapshot) => {
      const frame = frameFor(snapshot, surface());
      const source = local.sourceId
        ? frame?.sources.find((candidate) => candidate.id === local.sourceId)
        : frame?.sources.find((candidate) => candidate.nextCursor !== undefined);
      return { frameId: frame?.id, source };
    },
    undefined,
    (left, right) => left.frameId === right.frameId && left.source === right.source,
  );

  return renderElement(
    "button",
    createBoundProps<HTMLButtonElement>(() => {
      const available = selected().source?.nextCursor !== undefined;
      const loading = selected().source?.status === "loading";
      return {
        type: "button",
        "data-cmdflow-part": "load-more",
        "data-state": loading ? "loading" : available ? "available" : "unavailable",
        hidden: !local.forceMount && !available,
        disabled: Boolean(consumer.disabled) || loading || !available,
        onClick: () => {
          const current = selected();
          if (!current.source || !current.frameId) return;
          void flow.loadMore(current.source.id, {
            surface: surface(),
            frameId: current.frameId,
          });
        },
      };
    }, consumer),
  );
}

export type SeparatorProps = JSX.HTMLAttributes<HTMLDivElement> & SurfaceProps;

export function Separator(props: SeparatorProps): JSX.Element {
  const [local, consumer] = splitProps(props, ["surface"]);
  const surface = surfaceAccessor(() => local.surface);
  return renderElement(
    "div",
    createBoundProps<HTMLDivElement>(
      () => ({
        role: consumer.role ?? "separator",
        "data-cmdflow-part": "separator",
        "data-cmdflow-surface": surface(),
      }),
      consumer,
    ),
  );
}

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

export type ShortcutProps = JSX.HTMLAttributes<HTMLElement> & {
  readonly shortcut?: CmdFlowKeybinding | string;
};

export function Shortcut(props: ShortcutProps): JSX.Element {
  const [local, consumer] = splitProps(props, ["shortcut", "children"]);
  const item = useContext(ItemContext);
  const label = createMemo(() => {
    let shortcut = local.shortcut;
    if (shortcut === undefined) {
      for (const action of item?.item?.actions ?? []) {
        if (action.shortcut && (action.priority === "primary" || shortcut === undefined)) {
          shortcut = action.shortcut;
          if (action.priority === "primary") break;
        }
      }
    }
    return typeof shortcut === "string" ? shortcut : shortcut ? shortcutLabel(shortcut) : "";
  });

  return renderElement(
    "kbd",
    createBoundProps<HTMLElement>(
      () => ({
        "aria-label": label() || undefined,
        "data-cmdflow-part": "shortcut",
        hidden: local.children === undefined && !label(),
        children: local.children ?? label(),
      }),
      consumer,
    ),
  );
}

export type SelectionIndicatorProps = JSX.HTMLAttributes<HTMLSpanElement> & {
  readonly forceMount?: boolean;
};

export function SelectionIndicator(props: SelectionIndicatorProps): JSX.Element {
  const [local, consumer] = splitProps(props, ["forceMount"]);
  const item = useContext(ItemContext);
  return renderElement(
    "span",
    createBoundProps<HTMLSpanElement>(
      () => ({
        "aria-hidden": true,
        "data-cmdflow-part": "selection-indicator",
        "data-state": item?.selected ? "checked" : "unchecked",
        hidden: !local.forceMount && !item?.selected,
      }),
      consumer,
    ),
  );
}
