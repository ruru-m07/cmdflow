"use client";

import { Command } from "@cmdflow/react";
import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { CommandPalette } from "./command-palette/command-palette";
import {
  renderGithubAccessory,
  renderGithubAnnotation,
  renderGithubIcon,
} from "./github-example/presentation";
import type { GithubItemData } from "./github-example/types";
import { useGithubFlow } from "./github-example/use-github-flow";

const DOM_OPTIONS = { openShortcut: { key: "k", mod: true } } as const;

export default function Home() {
  const flow = useGithubFlow();

  return (
    <div>
      <ModeToggle />
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 pt-20 pb-14 text-center sm:px-6 sm:pt-24 sm:pb-16">
        <Command.Root flow={flow} domOptions={DOM_OPTIONS}>
          <Button variant="outline" render={<Command.Trigger />}>
            Open
            <Kbd>⌘&nbsp;K</Kbd>
          </Button>
          <CommandPalette<GithubItemData>
            renderListAnnotation={renderGithubAnnotation}
            renderItemIcon={renderGithubIcon}
            renderItemAccessory={renderGithubAccessory}
          />
        </Command.Root>
      </section>
    </div>
  );
}
