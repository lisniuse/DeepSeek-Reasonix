import { useSyncExternalStore } from "react";

// Whether the thinking + tool-call process auto-collapses into a peek
// container once the turn's conclusion has been output. Kept in a
// module-level store so every per-tab thread instance stays in sync — see
// sidebar.tsx for why localStorage alone can't bridge sibling instances.
const STORAGE_KEY = "reasonix.collapseProcessAfterDone";

function load(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

let collapseProcess = load();
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getCollapseProcess(): boolean {
  return collapseProcess;
}

export function setCollapseProcess(value: boolean): void {
  if (value === collapseProcess) return;
  collapseProcess = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* ignore — private mode */
  }
  for (const cb of listeners) cb();
}

export function useCollapseProcess(): boolean {
  return useSyncExternalStore(subscribe, getCollapseProcess);
}
