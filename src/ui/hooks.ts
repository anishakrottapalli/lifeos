import { createContext, useContext, useSyncExternalStore } from "react";
import type { LifeStore } from "../core/store";

export const StoreContext = createContext<LifeStore | null>(null);

/** The store, re-rendering whenever anything in the folder changes. */
export function useStore(): LifeStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("Store missing");
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}

export type Route =
  | { view: "home" }
  | { view: "module"; id: string }
  | { view: "item"; id: string; page?: "details" }
  | { view: "settings" };

export function timeAgo(stamp: string): string {
  if (!stamp) return "";
  const t = new Date(stamp.length === 10 ? stamp + "T00:00:00" : stamp).getTime();
  if (Number.isNaN(t)) return stamp;
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return stamp.slice(0, 10);
}

export function displayValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (v === true) return "Yes";
  if (v === false) return "";
  return String(v);
}
