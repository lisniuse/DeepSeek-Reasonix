import { useSyncExternalStore } from "react";

// Whether reasoning and tool-call cards expand by default. Kept in a
// module-level store so every per-tab thread instance stays in sync — see
// sidebar.tsx for why localStorage alone can't bridge sibling instances.
const STORAGE_KEY = "reasonix.autoExpandCards";

function load(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

let autoExpandCards = load();
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getAutoExpandCards(): boolean {
  return autoExpandCards;
}

export function setAutoExpandCards(value: boolean): void {
  if (value === autoExpandCards) return;
  autoExpandCards = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* ignore — private mode */
  }
  for (const cb of listeners) cb();
}

export function useAutoExpandCards(): boolean {
  return useSyncExternalStore(subscribe, getAutoExpandCards);
}
