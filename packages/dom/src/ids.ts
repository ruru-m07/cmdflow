import type {
  CandidateId,
  CmdFlow,
  CmdFlowFrameSnapshot,
  CmdFlowSnapshot,
  CmdFlowSurfaceAddress,
} from "@cmdflow/core";
import type { Address } from "./types.js";

let controllerSerial = 0;

export interface DomIds {
  address(value?: Address, snapshot?: CmdFlowSnapshot): CmdFlowSurfaceAddress;
  activeAddress(snapshot?: CmdFlowSnapshot): CmdFlowSurfaceAddress;
  frame(value?: Address, snapshot?: CmdFlowSnapshot): CmdFlowFrameSnapshot | undefined;
  addressKey(value?: Address, snapshot?: CmdFlowSnapshot): string;
  partId(part: string, value?: Address, suffix?: string, snapshot?: CmdFlowSnapshot): string;
  itemKey(id: CandidateId, value?: Address, snapshot?: CmdFlowSnapshot): string;
}

export function createDomIds<TContext, TData>(
  flow: CmdFlow<TContext, TData>,
  requestedPrefix?: string,
): DomIds {
  const prefix = requestedPrefix ?? `${flow.id}-${++controllerSerial}`;

  function address(value: Address = "main", snapshot = flow.getSnapshot()): CmdFlowSurfaceAddress {
    if (typeof value !== "string") return value;
    const frame = value === "actions" ? snapshot.actionFrame : snapshot.mainFrame;
    return { surface: value, frameId: frame?.id ?? "absent" };
  }

  function frame(
    value: Address = "main",
    snapshot = flow.getSnapshot(),
  ): CmdFlowFrameSnapshot | undefined {
    const resolved = address(value, snapshot);
    const frames = resolved.surface === "main" ? snapshot.mainFrames : snapshot.actionFrames;
    return frames.find((candidate) => candidate.id === resolved.frameId);
  }

  function addressKey(value: Address = "main", snapshot = flow.getSnapshot()): string {
    const resolved = address(value, snapshot);
    return `${resolved.surface}:${resolved.frameId}`;
  }

  function partId(
    part: string,
    value: Address = "main",
    suffix = "",
    snapshot = flow.getSnapshot(),
  ): string {
    const resolved = address(value, snapshot);
    return `${prefix}-${part}-${encodeURIComponent(resolved.surface)}-${encodeURIComponent(resolved.frameId)}-${encodeURIComponent(suffix)}`;
  }

  function itemKey(
    id: CandidateId,
    value: Address = "main",
    snapshot = flow.getSnapshot(),
  ): string {
    return `${addressKey(value, snapshot)}:${id}`;
  }

  function activeAddress(snapshot = flow.getSnapshot()): CmdFlowSurfaceAddress {
    return address(snapshot.actionFrame ? "actions" : "main", snapshot);
  }

  return { address, activeAddress, frame, addressKey, partId, itemKey };
}
