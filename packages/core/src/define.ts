import type {
  CmdFlowActionDefinition,
  CmdFlowActionOutcome,
  CmdFlowActionRunInput,
  CmdFlowCommandDefinition,
  CmdFlowExtensionDefinition,
  CmdFlowFormField,
  CmdFlowFormViewDefinition,
  CmdFlowResultSource,
  CmdFlowRunActionDefinition,
  CmdFlowViewDefinition,
} from "./contracts/definitions.js";

type DefaultContext = Record<string, never>;

type FormFieldValue<TField> = TField extends { readonly type: "checkbox" }
  ? boolean
  : TField extends { readonly type: "number" }
    ? number
    : TField extends { readonly type: "multi-select" }
      ? readonly string[]
      : TField extends { readonly type: "select" | "text" | "password" | "email" | "textarea" }
        ? string
        : never;

export type InferCmdFlowFormValues<
  TFields extends readonly { readonly id: string; readonly type: string }[],
> = Readonly<{
  [TField in TFields[number] as TField["id"]]: FormFieldValue<TField>;
}>;

type TypedFormSubmit<
  TContext,
  TData,
  TFields extends readonly CmdFlowFormField<TContext, TData>[],
> = Omit<CmdFlowRunActionDefinition<TContext, TData>, "run"> & {
  readonly run: (
    input: Omit<CmdFlowActionRunInput<TContext, TData>, "values"> & {
      readonly values: InferCmdFlowFormValues<TFields>;
    },
  ) =>
    | void
    | CmdFlowActionOutcome<TContext, TData>
    // biome-ignore lint/suspicious/noConfusingVoidType: Async action handlers intentionally support Promise<void>.
    | Promise<void | CmdFlowActionOutcome<TContext, TData>>;
};

export type TypedFormViewDefinition<
  TContext,
  TData,
  TFields extends readonly CmdFlowFormField<TContext, TData>[],
> = Omit<CmdFlowFormViewDefinition<TContext, TData>, "fields" | "submit"> & {
  readonly fields: TFields;
  readonly submit: TypedFormSubmit<TContext, TData, TFields>;
};

export function createDefinitions<TContext = DefaultContext, TData = unknown>() {
  return {
    command<const TCommand extends CmdFlowCommandDefinition<TContext, TData>>(command: TCommand) {
      return command;
    },
    commands<const TCommands extends readonly CmdFlowCommandDefinition<TContext, TData>[]>(
      commands: TCommands,
    ) {
      return commands;
    },
    action<const TAction extends CmdFlowActionDefinition<TContext, TData>>(action: TAction) {
      return action;
    },
    source<const TSource extends CmdFlowResultSource<TContext, TData>>(source: TSource) {
      return source;
    },
    extension<const TExtension extends CmdFlowExtensionDefinition<TContext, TData>>(
      extension: TExtension,
    ) {
      return extension;
    },
    view<const TView extends CmdFlowViewDefinition<TContext, TData>>(view: TView) {
      return view;
    },
    form<const TFields extends readonly CmdFlowFormField<TContext, TData>[]>(
      view: TypedFormViewDefinition<TContext, TData, TFields>,
    ): CmdFlowFormViewDefinition<TContext, TData> & { readonly fields: TFields } {
      return view as CmdFlowFormViewDefinition<TContext, TData> & { readonly fields: TFields };
    },
  };
}

export function defineCommand<
  TContext = DefaultContext,
  TData = unknown,
  const TCommand extends CmdFlowCommandDefinition<TContext, TData> = CmdFlowCommandDefinition<
    TContext,
    TData
  >,
>(command: TCommand): TCommand {
  return command;
}

export function defineCommands<
  TContext = DefaultContext,
  TData = unknown,
  const TCommands extends readonly CmdFlowCommandDefinition<
    TContext,
    TData
  >[] = readonly CmdFlowCommandDefinition<TContext, TData>[],
>(commands: TCommands): TCommands {
  return commands;
}

export function defineAction<
  TContext = DefaultContext,
  TData = unknown,
  const TAction extends CmdFlowActionDefinition<TContext, TData> = CmdFlowActionDefinition<
    TContext,
    TData
  >,
>(action: TAction): TAction {
  return action;
}

export function defineSource<
  TContext = DefaultContext,
  TData = unknown,
  const TSource extends CmdFlowResultSource<TContext, TData> = CmdFlowResultSource<TContext, TData>,
>(source: TSource): TSource {
  return source;
}

export function defineExtension<
  TContext = DefaultContext,
  TData = unknown,
  const TExtension extends CmdFlowExtensionDefinition<TContext, TData> = CmdFlowExtensionDefinition<
    TContext,
    TData
  >,
>(extension: TExtension): TExtension {
  return extension;
}

export function defineView<
  TContext = DefaultContext,
  TData = unknown,
  const TView extends CmdFlowViewDefinition<TContext, TData> = CmdFlowViewDefinition<
    TContext,
    TData
  >,
>(view: TView): TView {
  return view;
}

export function defineForm<
  TContext = DefaultContext,
  TData = unknown,
  const TFields extends readonly CmdFlowFormField<TContext, TData>[] = readonly CmdFlowFormField<
    TContext,
    TData
  >[],
>(
  view: TypedFormViewDefinition<TContext, TData, TFields>,
): CmdFlowFormViewDefinition<TContext, TData> & { readonly fields: TFields } {
  return view as CmdFlowFormViewDefinition<TContext, TData> & { readonly fields: TFields };
}
