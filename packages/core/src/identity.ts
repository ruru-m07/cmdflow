import type { CandidateId, MutableContextStore, Surface } from "./types.js";

export function createCandidateId(sourceId: string, itemId: string): CandidateId {
  return JSON.stringify([sourceId, itemId]) as CandidateId;
}

/** Opaque collision-safe key used by ranking reset/load APIs for one logical view. */
export function createRankingSurfaceId(
  surfaceId: string,
  surface: Surface,
  viewId: string,
): string {
  return JSON.stringify([surfaceId, surface, viewId]);
}

export function parseCandidateId(id: CandidateId): readonly [string, string] {
  const value: unknown = JSON.parse(id);
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    value.some((part) => typeof part !== "string")
  ) {
    throw new TypeError("Invalid CmdFlow candidate identity");
  }
  return Object.freeze([value[0] as string, value[1] as string]);
}

export function createContextStore<T>(initial: T): MutableContextStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

const ownedImmutableData = new WeakSet<object>();

/** Copies plain product data so consumers cannot mutate a published snapshot. */
export function immutable<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== "object") return value;
  // Only reuse objects recursively frozen by this function, never a host's shallow freeze.
  if (ownedImmutableData.has(value)) return value;
  const prior = seen.get(value);
  if (prior) return prior as T;
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    seen.set(value, result);
    for (const item of value) result.push(immutable(item, seen));
    ownedImmutableData.add(result);
    return Object.freeze(result) as T;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError(
      "CmdFlow snapshot data must use plain objects, arrays, or primitives. Keep opaque instances in a host registry.",
    );
  }
  const result: Record<string, unknown> = {};
  seen.set(value, result);
  for (const key of Object.keys(value)) {
    Object.defineProperty(result, key, {
      value: immutable((value as Record<string, unknown>)[key], seen),
      enumerable: true,
    });
  }
  ownedImmutableData.add(result);
  return Object.freeze(result) as T;
}
