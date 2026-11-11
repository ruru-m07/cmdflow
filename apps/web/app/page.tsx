"use client";

import { Command } from "@cmdflow/react";
import { useEffect, useState } from "react";
import { createDemoFlow, type DemoFlow } from "./demo-flow";
import { ExamplePalette } from "./example-palette";

const DOM_OPTIONS = { openShortcut: { key: "k", mod: true } } as const;

export default function Home() {
  const [activity, setActivity] = useState("Your command history stays in this browser.");
  const [demo, setDemo] = useState<DemoFlow | null>(null);

  useEffect(() => {
    const instance = createDemoFlow(setActivity);
    setDemo(instance);
    return () => instance.destroy();
  }, []);

  async function resetLearning() {
    if (!demo) return;

    try {
      await demo.flow.resetRanking();
      setActivity("Cleared the locally learned command order.");
    } catch {
      setActivity("Learning could not be reset. Refresh the page and try again.");
    }
  }

  return (
    <div className="min-h-svh overflow-x-clip bg-canvas text-foreground selection:bg-foreground selection:text-canvas">
      <main id="main-content" className="scroll-mt-6" tabIndex={-1}>
        <section
          className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 pt-20 pb-14 text-center sm:px-6 sm:pt-24 sm:pb-16"
          aria-labelledby="page-title"
        >
          <div className="mt-8" aria-busy={!demo}>
            {demo ? (
              <Command.Root flow={demo.flow} domOptions={DOM_OPTIONS}>
                <Command.Trigger className="inline-flex min-h-12 touch-manipulation items-center justify-center gap-6 rounded-lg border border-foreground bg-foreground px-4 text-sm font-semibold text-canvas transition-transform duration-150 hover:bg-foreground/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-canvas motion-reduce:transform-none motion-reduce:transition-none">
                  Open Command Palette
                  <kbd className="rounded border border-black/20 bg-black/10 px-1.5 py-0.5 font-mono text-[0.6875rem] [@media(pointer:coarse)]:hidden">
                    Ctrl / ⌘&nbsp;K
                  </kbd>
                </Command.Trigger>
                <ExamplePalette demo={demo} />
              </Command.Root>
            ) : (
              <button
                className="inline-flex min-h-12 items-center rounded-lg border border-border-strong bg-panel px-4 text-sm font-semibold text-muted"
                type="button"
                disabled
              >
                Preparing Command Palette…
              </button>
            )}
          </div>
        </section>

        <section
          className="mx-auto flex w-[calc(100%-2rem)] max-w-3xl flex-col gap-3 border-y border-border py-4 sm:w-[calc(100%-3rem)] sm:flex-row sm:items-center"
          aria-label="Demo activity"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-foreground" aria-hidden="true" />
          <p
            id="demo-status"
            className="min-w-0 flex-1 text-pretty text-sm text-muted"
            role="status"
            aria-live="polite"
          >
            {activity}
          </p>
          <button
            type="button"
            className="min-h-11 self-start rounded-md px-2 text-xs font-medium text-muted underline decoration-border-strong underline-offset-4 hover:text-foreground active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:cursor-wait disabled:opacity-50 sm:min-h-9 sm:self-auto"
            onClick={() => void resetLearning()}
            disabled={!demo}
            aria-describedby="demo-status"
          >
            Reset Learning
          </button>
        </section>
      </main>
    </div>
  );
}
