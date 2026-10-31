"use client";

import { type CmdFlow, type CmdFlowCommandDefinition, createCmdFlow } from "@cmdflow/core";
import {
  type CmdFlowDomController,
  createDomController,
  type DomControllerOptions,
} from "@cmdflow/dom";
import {
  createContext,
  createElement,
  Fragment,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

type AnyFlow = CmdFlow<unknown, unknown>;

export interface CommandContextValue {
  readonly flow: AnyFlow;
  readonly controller: CmdFlowDomController;
}

export const CommandContext = createContext<CommandContextValue | null>(null);
export const SurfaceContext = createContext<"main" | "actions">("main");

const useCommitEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

interface RootPresentationProps {
  readonly children?: ReactNode;
  readonly domOptions?: Omit<DomControllerOptions, "eventMode">;
}

export type ManagedRootProps<
  TContext = Record<string, never>,
  TData = unknown,
> = RootPresentationProps & {
  readonly commands: readonly CmdFlowCommandDefinition<TContext, TData>[];
  readonly flow?: never;
  readonly store?: never;
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly query?: string;
  readonly defaultQuery?: string;
  readonly onQueryChange?: (query: string) => void;
};

export interface AdvancedRootProps<TContext = unknown, TData = unknown>
  extends RootPresentationProps {
  readonly flow: CmdFlow<TContext, TData>;
  readonly store?: never;
  readonly commands?: never;
  readonly open?: never;
  readonly defaultOpen?: never;
  readonly onOpenChange?: never;
  readonly query?: never;
  readonly defaultQuery?: never;
  readonly onQueryChange?: never;
}

interface LegacyAdvancedRootProps<TContext = unknown, TData = unknown>
  extends RootPresentationProps {
  /** @deprecated Use `flow` instead. */
  readonly store: CmdFlow<TContext, TData>;
  readonly flow?: never;
  readonly commands?: never;
  readonly open?: never;
  readonly defaultOpen?: never;
  readonly onOpenChange?: never;
  readonly query?: never;
  readonly defaultQuery?: never;
  readonly onQueryChange?: never;
}

export type RootProps<TContext = Record<string, never>, TData = unknown> =
  | ManagedRootProps<TContext, TData>
  | AdvancedRootProps<TContext, TData>
  | LegacyAdvancedRootProps<TContext, TData>;

interface ManagedCallbacks {
  readonly onOpenChange?: (open: boolean) => void;
  readonly onQueryChange?: (query: string) => void;
}

interface Destroyable {
  destroy(): void;
}

function useStrictModeSafeDestroy(resource: Destroyable): void {
  const lifecycleRef = useRef<{
    resource: Destroyable;
    leases: number;
    destroyed: boolean;
  } | null>(null);
  if (lifecycleRef.current?.resource !== resource)
    lifecycleRef.current = { resource, leases: 0, destroyed: false };
  const lifecycle = lifecycleRef.current;
  useEffect(() => {
    lifecycle.leases += 1;
    return () => {
      lifecycle.leases -= 1;
      queueMicrotask(() => {
        if (lifecycle.leases === 0 && !lifecycle.destroyed) {
          lifecycle.destroyed = true;
          lifecycle.resource.destroy();
        }
      });
    };
  }, [lifecycle]);
}

function liveDomOptions(
  current: React.RefObject<Omit<DomControllerOptions, "eventMode"> | undefined>,
  id: string,
): DomControllerOptions {
  return {
    id,
    eventMode: "props",
    get scope() {
      return current.current?.scope;
    },
    get label() {
      return current.current?.label;
    },
    get searchLabel() {
      return current.current?.searchLabel;
    },
    get actionsLabel() {
      return current.current?.actionsLabel;
    },
    get backspaceToPop() {
      return current.current?.backspaceToPop;
    },
    get openShortcut() {
      return current.current?.openShortcut;
    },
    get actionShortcut() {
      return current.current?.actionShortcut;
    },
    get shortcutPriority() {
      return current.current?.shortcutPriority;
    },
    get restoreFocus() {
      return current.current?.restoreFocus;
    },
    get announcementDelay() {
      return current.current?.announcementDelay;
    },
    get onDiagnostic() {
      return current.current?.onDiagnostic;
    },
  };
}

function ControllerCommit({
  flow,
  controller,
}: {
  readonly flow: AnyFlow;
  readonly controller: CmdFlowDomController;
}): null {
  const subscribe = useCallback((listener: () => void) => flow.subscribe(listener), [flow]);
  const clientSnapshot = useCallback(() => flow.getSnapshot(), [flow]);
  const serverSnapshot = useCallback(() => flow.getServerSnapshot(), [flow]);
  const snapshot = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  useCommitEffect(() => controller.sync(snapshot), [controller, snapshot]);
  return null;
}

function FlowProvider({
  flow,
  children,
  domOptions,
}: RootPresentationProps & { readonly flow: AnyFlow }): ReactElement {
  const generatedId = useId();
  const domOptionsRef = useRef(domOptions);
  domOptionsRef.current = domOptions;
  const controllerId = domOptions?.id ?? generatedId;
  const controller = useMemo(
    () => createDomController(flow, liveDomOptions(domOptionsRef, controllerId)),
    [controllerId, flow],
  );
  useStrictModeSafeDestroy(controller);
  const value = useMemo<CommandContextValue>(() => ({ flow, controller }), [controller, flow]);
  return createElement(
    CommandContext.Provider,
    { value },
    createElement(Fragment, null, children, createElement(ControllerCommit, { flow, controller })),
  );
}

function useMainFrameId(flow: AnyFlow): string {
  const subscribe = useCallback((listener: () => void) => flow.subscribe(listener), [flow]);
  const clientSnapshot = useCallback(() => flow.getSnapshot().mainFrame.id, [flow]);
  const serverSnapshot = useCallback(() => flow.getServerSnapshot().mainFrame.id, [flow]);
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}

function ManagedRoot<TContext, TData>(props: ManagedRootProps<TContext, TData>): ReactElement {
  const callbacks = useRef<ManagedCallbacks>({
    onOpenChange: props.onOpenChange,
    onQueryChange: props.onQueryChange,
  });
  callbacks.current = {
    onOpenChange: props.onOpenChange,
    onQueryChange: props.onQueryChange,
  };
  const flowRef = useRef<CmdFlow<TContext, TData> | null>(null);
  const [flow] = useState(() => {
    const created = createCmdFlow<TContext, TData>({
      commands: props.commands,
      initialOpen: props.open ?? props.defaultOpen,
      initialQuery: props.query ?? props.defaultQuery,
      controlledOpen: props.open !== undefined,
      controlledQuery: props.query !== undefined,
      onOpenChange(open) {
        callbacks.current.onOpenChange?.(open);
      },
      onQueryChange(query, address) {
        if (address.surface === "actions") {
          flowRef.current?.syncQuery(query, address);
          return;
        }
        callbacks.current.onQueryChange?.(query);
      },
    });
    flowRef.current = created;
    return created;
  });
  useStrictModeSafeDestroy(flow);
  const mainFrameId = useMainFrameId(flow as AnyFlow);
  useCommitEffect(() => {
    if (props.open !== undefined) flow.setOpen(props.open);
  }, [flow, props.open]);
  useCommitEffect(() => {
    if (props.query !== undefined)
      flow.syncQuery(props.query, { surface: "main", frameId: mainFrameId });
  }, [flow, mainFrameId, props.query]);
  return createElement(
    FlowProvider,
    { flow: flow as AnyFlow, domOptions: props.domOptions },
    props.children,
  );
}

function AdvancedRoot<TContext, TData>(props: AdvancedRootProps<TContext, TData>): ReactElement {
  return createElement(
    FlowProvider,
    { flow: props.flow as AnyFlow, domOptions: props.domOptions },
    props.children,
  );
}

export function Root<TContext = Record<string, never>, TData = unknown>(
  props: RootProps<TContext, TData>,
): ReactElement {
  if (props.flow) return createElement(AdvancedRoot<TContext, TData>, props);
  if (props.store)
    return createElement(
      AdvancedRoot<TContext, TData>,
      {
        flow: props.store,
        domOptions: props.domOptions,
      },
      props.children,
    );
  return createElement(ManagedRoot<TContext, TData>, props);
}
