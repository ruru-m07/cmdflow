"use client";

import { cn } from "@/lib/utils";
import { type CmdFlowResolvedItem, Command } from "@cmdflow/react";
import type { ReactNode } from "react";

interface ResultItemProps<TData> {
  readonly item: CmdFlowResolvedItem<TData>;
  readonly first: boolean;
  readonly renderIcon?: (item: CmdFlowResolvedItem<TData>) => ReactNode;
  readonly renderAccessory?: (item: CmdFlowResolvedItem<TData>) => ReactNode;
}

export function ResultItem<TData>({
  item,
  first,
  renderIcon,
  renderAccessory,
}: ResultItemProps<TData>) {
  return (
    <Command.Item
      item={item}
      className={cn(
        "group flex min-h-10 touch-manipulation select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-foreground",
        "data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50 data-[state=active]:bg-input/70",
        "forced-colors:data-[state=active]:outline forced-colors:data-[state=active]:outline-1 [@media(pointer:coarse)]:min-h-11",
        first ? "scroll-mt-8" : "",
      )}
    >
      <span
        className={cn(
          "grid shrink-0 text-sm text-muted-foreground",
          "group-data-[state=active]:text-foreground"
        )}
        aria-hidden="true"
      >
        {renderIcon?.(item) ?? "⌘"}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm">{item.title}</span>
      </span>
      {/* {renderAccessory?.(item)} */}
    </Command.Item>
  );
}
