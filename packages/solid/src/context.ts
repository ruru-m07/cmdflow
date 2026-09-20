import {
  type CmdFlow,
  type CmdFlowCommandDefinition,
  type CmdFlowSnapshot,
  createCmdFlow,
} from "@cmdflow/core";
import {
  type CmdFlowDomController,
  createDomController,
  type DomControllerOptions,
} from "@cmdflow/dom";
import {
  type Accessor,
  createComponent,
  createContext,
  createEffect,
  createSignal,
  createUniqueId,
  type JSX,
  onCleanup,
  onMount,
  useContext,
} from "solid-js";
import { isServer } from "solid-js/web";

type AnyFlow = CmdFlow<unknown, unknown>;

interface CommandContextValue {
  readonly flow: AnyFlow;
  readonly controller: CmdFlowDomController;
  readonly snapshot: Accessor<CmdFlowSnapshot>;
}

export const CommandContext = createContext<CommandContextValue>();
export const SurfaceContext = createContext<"main" | "actions">("main");

export function useCommandContext(): CommandContextValue {
  const context = useContext(CommandContext);
  if (!context) throw new Error("CmdFlow primitives must be inside Command.Root.");
  return context;
}

function createSnapshot(flow: AnyFlow): Accessor<CmdFlowSnapshot> {
  const [snapshot, setSnapshot] = createSignal(
    isServer ? flow.getServerSnapshot() : flow.getSnapshot(),
  );

  onMount(() => {
    const update = (): void => {
      setSnapshot(() => flow.getSnapshot());
    };
    const unsubscribe = flow.subscribe(update);
    update();
    onCleanup(unsubscribe);
  });

  return snapshot;
}

function liveDomOptions(
  current: () => Omit<DomControllerOptions, "eventMode"> | undefined,
  id: string,
): DomControllerOptions {
  return {
    id,
    eventMode: "props",
    get scope() {
      return current()?.scope;
    },
    get label() {
      return current()?.label;
    },
    get searchLabel() {
      return current()?.searchLabel;
    },
    get actionsLabel() {
      return current()?.actionsLabel;
    },
    get backspaceToPop() {
      return current()?.backspaceToPop;
    },
    get openShortcut() {
      return current()?.openShortcut;
    },
    get actionShortcut() {
      return current()?.actionShortcut;
    },
    get shortcutPriority() {
      return current()?.shortcutPriority;
    },
    get restoreFocus() {
      return current()?.restoreFocus;
    },
    get announcementDelay() {
      return current()?.announcementDelay;
    },
    get onDiagnostic() {
      return current()?.onDiagnostic;
    },
  };
}

function createFlowBinding(
  flow: AnyFlow,
  domOptions: () => Omit<DomControllerOptions, "eventMode"> | undefined,
): CommandContextValue {
  const snapshot = createSnapshot(flow);
  const controllerId = domOptions()?.id ?? createUniqueId();
  const controller = createDomController(flow, liveDomOptions(domOptions, controllerId));
  const context: CommandContextValue = { flow, controller, snapshot };

  createEffect(() => controller.sync(snapshot()));
  onCleanup(() => controller.destroy());

  return context;
}

function provideFlow(context: CommandContextValue, children: () => JSX.Element): JSX.Element {
  return createComponent(CommandContext.Provider, {
    value: context,
    get children() {
      return children();
    },
  });
}

interface RootPresentationProps {
  readonly children?: JSX.Element;
  readonly domOptions?: Omit<DomControllerOptions, "eventMode">;
}

export type ManagedRootProps<
  TContext = Record<string, never>,
  TData = unknown,
> = RootPresentationProps & {
  readonly commands: readonly CmdFlowCommandDefinition<TContext, TData>[];
  readonly flow?: never;
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
  | AdvancedRootProps<TContext, TData>;

function ManagedRoot<TContext, TData>(props: ManagedRootProps<TContext, TData>): JSX.Element {
  let flow: CmdFlow<TContext, TData>;
  flow = createCmdFlow<TContext, TData>({
    commands: props.commands,
    initialOpen: props.open ?? props.defaultOpen,
    initialQuery: props.query ?? props.defaultQuery,
    controlledOpen: props.open !== undefined,
    controlledQuery: props.query !== undefined,
    onOpenChange(open) {
      props.onOpenChange?.(open);
    },
    onQueryChange(query, address) {
      if (address.surface === "actions") {
        flow.syncQuery(query, address);
        return;
      }
      props.onQueryChange?.(query);
    },
  });
  onCleanup(() => flow.destroy());

  const binding = createFlowBinding(flow as AnyFlow, () => props.domOptions);

  createEffect(() => {
    if (props.open !== undefined) flow.setOpen(props.open);
  });
  createEffect(() => {
    if (props.query === undefined) return;
    flow.syncQuery(props.query, {
      surface: "main",
      frameId: binding.snapshot().mainFrame.id,
    });
  });

  return provideFlow(binding, () => props.children);
}

function AdvancedRoot<TContext, TData>(props: AdvancedRootProps<TContext, TData>): JSX.Element {
  const binding = createFlowBinding(props.flow as AnyFlow, () => props.domOptions);
  return provideFlow(binding, () => props.children);
}

export function Root<TContext = Record<string, never>, TData = unknown>(
  props: RootProps<TContext, TData>,
): JSX.Element {
  if (props.flow) return AdvancedRoot(props as AdvancedRootProps<TContext, TData>);
  return ManagedRoot(props as ManagedRootProps<TContext, TData>);
}
