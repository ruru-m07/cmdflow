import type { InputElement } from "./types.js";

export interface ElementRegistry {
  dialog: HTMLElement | null;
  status: HTMLElement | null;
  internalStatus: HTMLElement | null;
  confirmation: HTMLElement | null;
  readonly inputs: Map<string, HTMLInputElement>;
  readonly lists: Map<string, HTMLElement>;
  readonly forms: Map<string, HTMLFormElement>;
  readonly fields: Map<string, InputElement>;
  readonly items: Map<string, HTMLElement>;
  clear(): void;
}

export function createElementRegistry(): ElementRegistry {
  const registry: ElementRegistry = {
    dialog: null,
    status: null,
    internalStatus: null,
    confirmation: null,
    inputs: new Map(),
    lists: new Map(),
    forms: new Map(),
    fields: new Map(),
    items: new Map(),
    clear() {
      registry.dialog = null;
      registry.status = null;
      registry.internalStatus = null;
      registry.confirmation = null;
      registry.inputs.clear();
      registry.lists.clear();
      registry.forms.clear();
      registry.fields.clear();
      registry.items.clear();
    },
  };
  return registry;
}
