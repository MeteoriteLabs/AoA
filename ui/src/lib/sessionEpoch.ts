import { useSyncExternalStore } from "react";

let sessionEpoch = 0;
const listeners = new Set<() => void>();

export function advanceSessionEpoch(): void {
  sessionEpoch += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): number {
  return sessionEpoch;
}

export function useSessionEpoch(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Test-only reset for this module-level identity transition clock. */
export function resetSessionEpochForTests(): void {
  sessionEpoch = 0;
  for (const listener of listeners) listener();
}
