export const MINIMAL_REACT_SOURCE = `"use client";

import {
  Command,
  type CmdFlowCommandDefinition,
} from "@cmdflow/react";
import "@cmdflow/react/preset.css";

const commands = [
  {
    id: "settings.open",
    title: "Open settings",
    action: {
      type: "run",
      id: "open",
      title: "Open settings",
      run: () => window.location.assign("/settings"),
    },
  },
] satisfies readonly CmdFlowCommandDefinition[];

export function CommandPalette() {
  return (
    <Command.Root commands={commands}>
      <Command.Trigger>Open commands</Command.Trigger>
      <Command.Dialog aria-label="Application commands">
        <Command.Input aria-label="Search commands" />
        <Command.List>
          {(item) => <Command.Item key={item.candidateId} item={item} />}
        </Command.List>
        <Command.Status />
      </Command.Dialog>
    </Command.Root>
  );
}`;
