"use client";

import { Command } from "@cmdflow/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MINIMAL_REACT_SOURCE } from "./demo/source-example";
import { createDemoFlow, type DemoFlow } from "./demo-flow";
import { ExamplePalette } from "./example-palette";

const DOM_OPTIONS = { openShortcut: { key: "k", mod: true } } as const;

const GUIDE_STEPS = [
  {
    number: "01",
    title: "Search & Load",
    description: "Open My Pull Requests to try async search, pagination, loading, and recovery.",
  },
  {
    number: "02",
    title: "Open Actions",
    description: "Use Ctrl / ⌘ K on a result to browse nested actions and confirmation states.",
  },
  {
    number: "03",
    title: "Complete a Form",
    description: "Choose Create Pull Request to try validation, submission, and draft protection.",
  },
] as const;

type CopyState = "idle" | "copied" | "unavailable";

export default function Home() {
  const [activity, setActivity] = useState("Your command history stays in this browser.");
  const [copyState, setCopyState] = useState<CopyState>("idle");
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

  async function copySource() {
    try {
      await navigator.clipboard.writeText(MINIMAL_REACT_SOURCE);
      setCopyState("copied");
      setActivity("Copied the React example to your clipboard.");
    } catch {
      setCopyState("unavailable");
      setActivity("Clipboard access is unavailable. Use the GitHub link to copy the example.");
    }
  }

  return (
    <div className="min-h-svh overflow-x-clip bg-canvas text-foreground selection:bg-foreground selection:text-canvas">
      <a
        href="#main-content"
        className="fixed top-3 left-3 z-[100] -translate-y-20 rounded-md bg-foreground px-3 py-2 text-sm font-semibold text-canvas focus-visible:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        Skip to Content
      </a>

      <header className="border-b border-border pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex min-h-16 w-full max-w-5xl items-center justify-between gap-4 [padding-left:max(1rem,env(safe-area-inset-left))] [padding-right:max(1rem,env(safe-area-inset-right))] sm:px-6">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2.5 rounded-md font-semibold tracking-[-0.03em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-canvas sm:min-h-9"
            aria-label="CmdFlow home"
          >
            <span
              className="grid size-7 place-items-center rounded-md border border-border-strong bg-panel font-mono text-sm"
              aria-hidden="true"
            >
              ⌘
            </span>
            <span translate="no">CmdFlow</span>
          </Link>

          <nav className="flex items-center gap-4 text-sm" aria-label="Primary navigation">
            <span className="hidden font-mono text-xs text-muted sm:inline">v0.2</span>
            <a
              href="https://github.com/ruru-m07/cmdflow"
              className="rounded-md text-muted underline decoration-border-strong underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
              target="_blank"
              rel="noreferrer"
            >
              GitHub <span aria-hidden="true">↗</span>
            </a>
          </nav>
        </div>
      </header>

      <main id="main-content" className="scroll-mt-6" tabIndex={-1}>
        <section
          className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 pt-20 pb-14 text-center sm:px-6 sm:pt-24 sm:pb-16"
          aria-labelledby="page-title"
        >
          <p className="font-mono text-xs font-medium tracking-[0.14em] text-muted uppercase">
            Headless Command Workflows
          </p>
          <h1
            id="page-title"
            className="mt-5 max-w-2xl text-balance text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-5xl"
          >
            A Command Palette for Real Workflows
          </h1>
          <p className="mt-5 max-w-xl text-pretty text-base leading-7 text-muted">
            Search commands, open contextual actions, load async results, and complete forms through
            one framework-neutral flow.
          </p>

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
          <p className="mt-3 text-pretty text-xs leading-5 text-muted">
            No account or network request required.
            <span className="hidden sm:inline"> Press Ctrl / ⌘&nbsp;K from anywhere.</span>
          </p>
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

        <section
          className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-20"
          aria-labelledby="guide-title"
        >
          <div className="mx-auto max-w-xl text-center">
            <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">Try the Demo</p>
            <h2
              id="guide-title"
              className="mt-3 text-balance text-2xl font-semibold tracking-[-0.035em] sm:text-3xl"
            >
              Three Paths, One Surface
            </h2>
          </div>

          <ol className="mt-10 grid border-y border-border md:grid-cols-3 md:divide-x md:divide-border">
            {GUIDE_STEPS.map((step) => (
              <li
                key={step.number}
                className="border-b border-border py-6 last:border-b-0 md:border-b-0 md:px-6 md:first:pl-0 md:last:pr-0"
              >
                <span className="font-mono text-xs tabular-nums text-muted">{step.number}</span>
                <h3 className="mt-4 text-base font-semibold tracking-[-0.02em]">{step.title}</h3>
                <p className="mt-2 text-pretty text-sm leading-6 text-muted">{step.description}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-xs text-muted [padding-left:max(1rem,env(safe-area-inset-left))] [padding-right:max(1rem,env(safe-area-inset-right))] sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>Headless by default. Styled only when you choose.</span>
          <button
            type="button"
            className="min-h-11 self-start rounded-md px-2 font-medium text-muted underline decoration-border-strong underline-offset-4 hover:text-foreground active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground sm:min-h-9 sm:self-auto"
            onClick={() => void copySource()}
            aria-describedby="demo-status"
          >
            {copyState === "copied"
              ? "Copied"
              : copyState === "unavailable"
                ? "Try Copy Again"
                : "Copy React Example"}
          </button>
        </div>
      </footer>
    </div>
  );
}
