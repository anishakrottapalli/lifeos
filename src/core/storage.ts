// How the screens talk to the disk. In the Mac app this goes through the Rust
// helper (src-tauri). In a plain browser (for previews and tests) it uses an
// in-memory folder so the screens can be tried without touching real files.

import type { Entry, Settings } from "./types";

export interface Storage {
  kind: "mac" | "memory";
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  openRoot(root: string): Promise<void>;
  scan(): Promise<Entry[]>;
  readMany(paths: string[]): Promise<(string | null)[]>;
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  /** Rename or move a whole folder. */
  renameDir(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  /** Move a file from anywhere on the Mac into the LifeOS folder. */
  importFile(fromAbs: string, to: string): Promise<void>;
  open(path: string): Promise<void>;
  reveal(path: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  pickFiles(): Promise<string[]>;
  onChange(cb: () => void): () => void;
}

export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function createStorage(): Promise<Storage> {
  if (inTauri()) {
    const { TauriStorage } = await import("./storage-tauri");
    return new TauriStorage();
  }
  const { MemoryStorage } = await import("./storage-memory");
  return new MemoryStorage(true);
}
