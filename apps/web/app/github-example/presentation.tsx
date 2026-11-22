"use client";

import type { CmdFlowResolvedItem } from "@cmdflow/react";
import type { ListViewContext } from "../command-palette/list-view";
import { commandIcon } from "./icons";
import type { GithubItemData } from "./types";

function calculate(query: string): { readonly expression: string; readonly result: string } | null {
  const match = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*([+*/-])\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) return null;

  const [, leftText, operator, rightText] = match;
  const left = Number(leftText);
  const right = Number(rightText);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;

  const value =
    operator === "+"
      ? left + right
      : operator === "-"
        ? left - right
        : operator === "*"
          ? left * right
          : right === 0
            ? Number.NaN
            : left / right;
  if (!Number.isFinite(value)) return null;

  return { expression: `${left} ${operator} ${right}`, result: String(value) };
}

export function renderGithubIcon(item: CmdFlowResolvedItem<GithubItemData>) {
  const icon = item.data?.icon;
  const Icon = commandIcon(icon);
  if (Icon) return <Icon size={16} strokeWidth={1.75} />;
  return icon ?? "⌘";
}

export function renderGithubAccessory(item: CmdFlowResolvedItem<GithubItemData>) {
  return item.data ? (
    <span className="hidden shrink-0 text-[0.6875rem] font-medium text-muted-foreground group-data-[state=active]:text-canvas/70 sm:inline">
      {item.data.accessory}
    </span>
  ) : null;
}

export function renderGithubAnnotation({ frame }: ListViewContext<GithubItemData>) {
  const calculation = calculate(frame.query);
  if (calculation) {
    return (
      <section className="mx-2 mt-2 overflow-hidden rounded-md border border-border-strong bg-panel-raised">
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-[0.625rem] font-medium tracking-[0.12em] text-muted-foreground uppercase">
          <span>Calculator</span>
          <span>Custom annotation</span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-4 text-center">
          <strong className="text-lg text-foreground">{calculation.expression}</strong>
          <span className="text-lg text-muted-foreground" aria-hidden="true">
            →
          </span>
          <strong className="text-lg text-foreground">{calculation.result}</strong>
        </div>
      </section>
    );
  }

  return null;
}
