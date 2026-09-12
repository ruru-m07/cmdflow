"use client";

import type { ResolvedItem } from "@cmdflow/core";
import { Command, useCmdflow } from "@cmdflow/react";
import { useEffect, useState } from "react";
import { createDemoFlow } from "./demo-flow";
import styles from "./page.module.css";

type Demo = ReturnType<typeof createDemoFlow>;

function Result({ item }: { item: ResolvedItem }) {
  return (
    <Command.Item item={item} className={styles.item}>
      <span className={styles.itemIcon} aria-hidden="true">
        {item.sourceId === "pull-requests" ? "↗" : "⌘"}
      </span>
      <span className={styles.itemCopy}>
        <span>{item.title}</span>
        <small>{item.subtitle}</small>
      </span>
      <span className={styles.itemHint} aria-hidden="true">
        ↵
      </span>
    </Command.Item>
  );
}

function Palette({ demo }: { demo: Demo }) {
  const { store, snapshot } = useCmdflow();
  const frame = snapshot.current;
  const actionFrame = snapshot.actionFrame;
  const primary = frame.actions.find((action) => action.priority === "primary");
  const source = frame.sources[0];
  const execution = snapshot.executions.at(-1);
  return (
    <Command.Dialog className={styles.palette} aria-label="CmdFlow command palette">
      <div className={styles.paletteHeader}>
        {snapshot.main.length > 1 ? (
          <Command.Back className={styles.back}>
            ← <span>Back</span>
          </Command.Back>
        ) : (
          <span className={styles.paletteBrand}>
            ⌘ <span>CmdFlow</span>
          </span>
        )}
        <span className={styles.viewTitle}>{frame.view.title}</span>
        <Command.Close className={styles.close}>Esc</Command.Close>
      </div>
      {frame.view.type === "list" ? (
        <>
          <Command.Input
            className={styles.search}
            aria-label="Search commands"
            placeholder={snapshot.main.length > 1 ? "Search pull requests…" : "Search for GitHub…"}
          />
          <div className={styles.listMeta}>
            <span>{source ? "PULL REQUESTS" : "RESULTS"}</span>
            <span>
              {frame.items.length} {source?.status === "loading" ? "· Loading…" : ""}
            </span>
          </div>
          <Command.List className={styles.list}>
            {(item) => <Result key={item.candidateId} item={item} />}
          </Command.List>
          {source?.status === "error" ? (
            <div className={styles.sourceNotice} role="alert">
              <span>{source.error}</span>
              <button type="button" onClick={() => store.refresh()}>
                Retry source
              </button>
            </div>
          ) : null}
          {frame.items.length === 0 &&
          source?.status !== "loading" &&
          source?.status !== "error" ? (
            <p className={styles.empty}>No commands found. Try another search.</p>
          ) : null}
          {source ? (
            <div className={styles.sourceControls}>
              <span>Local async fixture</span>
              {source.nextCursor ? (
                <button
                  type="button"
                  disabled={source.status === "loading"}
                  onClick={() => {
                    void store.loadMore(source.id);
                  }}
                >
                  Load more
                </button>
              ) : null}
              <button type="button" onClick={() => demo.failNextRequest()}>
                Simulate error
              </button>
            </div>
          ) : null}
        </>
      ) : frame.view.type === "form" ? (
        <Command.Form className={styles.form}>
          <h2>{frame.view.title}</h2>
          <p>{frame.view.description}</p>
          <div className={styles.field}>
            <Command.FieldLabel fieldId="title" />
            <Command.Field fieldId="title" placeholder="What does this change do?" />
            <Command.FieldError fieldId="title" />
          </div>
          <div className={styles.field}>
            <Command.FieldLabel fieldId="body" />
            <Command.Textarea fieldId="body" rows={3} placeholder="Add some context…" />
          </div>
          <div className={styles.field}>
            <Command.FieldLabel fieldId="base" />
            <Command.Select fieldId="base" />
          </div>
          <Command.FieldLabel fieldId="draft" className={styles.checkbox}>
            <Command.Field fieldId="draft" /> Create as draft
          </Command.FieldLabel>
          <div className={styles.formButtons}>
            <Command.Back aria-label="Cancel">Cancel</Command.Back>
            <button type="submit" disabled={frame.form.submitting}>
              {frame.form.submitting ? "Creating…" : "Create pull request"}
            </button>
          </div>
        </Command.Form>
      ) : (
        <article className={styles.detail}>
          <span className={styles.detailIcon}>↗</span>
          <h2>{frame.view.title}</h2>
          <p>{frame.view.description}</p>
          <button
            type="button"
            onClick={() => {
              void store.invoke({ address: { surface: "main", frameId: frame.id } });
            }}
          >
            Mark reviewed
          </button>
        </article>
      )}
      {execution?.status === "error" ? (
        <p className={styles.sourceNotice} role="alert">
          {execution.error ?? "The action could not be completed."}
        </p>
      ) : null}
      <div className={styles.paletteFooter}>
        <span className={styles.footerHint}>
          {snapshot.rankingReady ? "Learns from successful actions" : "Loading local preferences…"}
        </span>
        <div>
          <span className={styles.primaryAction}>{primary?.title ?? "Navigate"}</span>
          <kbd>↵</kbd>
          <span className={styles.footerDivider} />
          <Command.ActionsTrigger className={styles.actionsButton}>
            Actions <kbd>⌘ K</kbd>
          </Command.ActionsTrigger>
        </div>
      </div>
      <Command.Actions className={styles.actions} aria-label="Contextual actions">
        <div className={styles.actionsHeader}>
          <Command.Back>←</Command.Back>
          <span>{actionFrame?.view.title ?? "Actions"}</span>
        </div>
        <Command.Input
          className={styles.actionSearch}
          aria-label="Search actions"
          placeholder="Search actions…"
        />
        <Command.List className={styles.actionList}>
          {(item) => (
            <Command.Item key={item.candidateId} item={item} className={styles.actionItem}>
              <span>{item.title}</span>
              {item.disabled ? <small>{item.disabledReason}</small> : null}
            </Command.Item>
          )}
        </Command.List>
      </Command.Actions>
      <Command.Confirmation className={styles.confirmation}>
        <h2>{snapshot.confirmation?.title}</h2>
        <p>
          {snapshot.confirmation?.kind === "discard"
            ? "Your unsaved form changes will be discarded."
            : "Confirm this demo action to continue."}
        </p>
        <div>
          <Command.CancelConfirmation>Keep editing</Command.CancelConfirmation>
          <Command.Confirm>Confirm</Command.Confirm>
        </div>
      </Command.Confirmation>
      <Command.Status />
    </Command.Dialog>
  );
}

export default function Home() {
  const [demo, setDemo] = useState<Demo | null>(null);
  const [activity, setActivity] = useState("Your command history stays in this browser.");
  useEffect(() => {
    const instance = createDemoFlow(setActivity);
    setDemo(instance);
    return () => instance.destroy();
  }, []);
  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <a href="/" className={styles.logo}>
          <span>⌘</span> cmdflow
        </a>
        <a href="https://github.com/ruru-m07/cmdflow">View source ↗</a>
      </nav>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>
          <span /> HEADLESS. CONTEXTUAL. YOURS.
        </div>
        <h1>
          One panel.
          <br />
          <span>Every possibility.</span>
        </h1>
        <p>
          A command interface that understands the next step. Search, navigate, act, and pick up
          exactly where you left off.
        </p>
        {demo ? (
          <Command.Root store={demo.store}>
            <Command.Trigger className={styles.launch}>
              Open command panel <kbd>⌘ K</kbd>
            </Command.Trigger>
            <Palette demo={demo} />
          </Command.Root>
        ) : (
          <button type="button" disabled className={styles.launch}>
            Preparing command panel…
          </button>
        )}
        <span className={styles.hint}>Or press Ctrl / ⌘ K anywhere on this page</span>
      </section>
      <section className={styles.features} aria-label="Try the interaction model">
        <article>
          <span>01 / REMEMBERS</span>
          <h2>Your next search gets smarter.</h2>
          <p>
            Search “GitHub”, choose Notifications, then reopen. Successful actions refine ranking
            locally; highlighting does not.
          </p>
        </article>
        <article>
          <span>02 / GOES DEEPER</span>
          <h2>Commands become workflows.</h2>
          <p>
            Open My pull requests for async results. Create a pull request for native inputs,
            validation, and draft protection.
          </p>
        </article>
        <article>
          <span>03 / STAYS IN CONTEXT</span>
          <h2>More actions. Same place.</h2>
          <p>
            Press Ctrl / ⌘ K on a result. Search its actions, enter Organize, or open a related form
            without losing your place.
          </p>
        </article>
      </section>
      <section className={styles.activity} aria-label="Demo activity">
        <span className={styles.activityDot} />
        <p role="status">{activity}</p>
        {demo ? (
          <button
            type="button"
            onClick={async () => {
              await demo.store.resetRanking();
              setActivity("Local learned ranking has been reset.");
            }}
          >
            Reset learning
          </button>
        ) : null}
      </section>
      <footer className={styles.pageFooter}>
        <span>Built with @cmdflow/core + @cmdflow/react</span>
        <span>Local fixture data · No GitHub account needed</span>
      </footer>
    </main>
  );
}
