"use client";

import { Command } from "@cmdflow/react";
import { useEffect, useState } from "react";
import { createDemoFlow, type DemoFlow } from "./demo-flow";
import { ExamplePalette } from "./example-palette";
import { ModeToggle } from "@/components/mode-toggle";
import { Kbd } from "@/components/ui/kbd";
import { Button } from "@/components/ui/button";

const DOM_OPTIONS = { openShortcut: { key: "k", mod: true } } as const;

export default function Home() {
  const [_, setActivity] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoFlow | null>(null);

  useEffect(() => {
    const instance = createDemoFlow(setActivity);
    setDemo(instance);
    return () => instance.destroy();
  }, []);

  return (
    <div>
      <ModeToggle />
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 pt-20 pb-14 text-center sm:px-6 sm:pt-24 sm:pb-16">
        {demo ? (
          <Command.Root flow={demo.flow} domOptions={DOM_OPTIONS}>
            <Button variant={"outline"} render={<Command.Trigger />}>
              Open
              <Kbd>⌘&nbsp;K</Kbd>
            </Button>
            <ExamplePalette demo={demo} />
          </Command.Root>
        ) : null}
      </section>
    </div>
  );
}
