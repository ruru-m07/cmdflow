import type { LucideIcon } from "lucide-react";

const icons = new Map<string, LucideIcon>();

/** Keeps the component outside the CmdFlow snapshot and returns the id stored on the command. */
export function registerCommandIcon(id: string, icon: LucideIcon): string {
  icons.set(id, icon);
  return id;
}

export function commandIcon(id: string | undefined): LucideIcon | undefined {
  return id ? icons.get(id) : undefined;
}
