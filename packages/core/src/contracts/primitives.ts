declare const candidateIdBrand: unique symbol;

/** Stable, collision-safe identity for one command candidate. */
export type CandidateId = string & { readonly [candidateIdBrand]: true };

export type CmdFlowSurface = "main" | "actions";

export interface CmdFlowSurfaceAddress {
  readonly surface: CmdFlowSurface;
  readonly frameId: string;
}

export interface CmdFlowClock {
  now(): number;
}

export interface CmdFlowContextStore<TContext> {
  getSnapshot(): TContext;
  subscribe(listener: () => void): () => void;
}

export interface MutableCmdFlowContextStore<TContext> extends CmdFlowContextStore<TContext> {
  set(value: TContext): void;
}

export type CmdFlowAvailability = boolean | { readonly reason: string };

export interface CmdFlowKeybinding {
  readonly key: string;
  readonly mod?: boolean;
  readonly ctrl?: boolean;
  readonly meta?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
}

/** @deprecated Use {@link CmdFlowSurface}. */
export type Surface = CmdFlowSurface;
/** @deprecated Use {@link CmdFlowSurfaceAddress}. */
export type SurfaceAddress = CmdFlowSurfaceAddress;
/** @deprecated Use {@link CmdFlowClock}. */
export type Clock = CmdFlowClock;
/** @deprecated Use {@link CmdFlowContextStore}. */
export type ContextStore<TContext> = CmdFlowContextStore<TContext>;
/** @deprecated Use {@link MutableCmdFlowContextStore}. */
export type MutableContextStore<TContext> = MutableCmdFlowContextStore<TContext>;
/** @deprecated Use {@link CmdFlowAvailability}. */
export type Availability = CmdFlowAvailability;
/** @deprecated Use {@link CmdFlowKeybinding}. */
export type Keybinding = CmdFlowKeybinding;
