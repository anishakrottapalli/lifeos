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
  /** Remove a folder only if it is completely empty. True if it was removed, false if it has something in it or isn't there. */
  removeEmptyDir(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  /** Move a file from anywhere on the Mac into the LifeOS folder. */
  importFile(fromAbs: string, to: string): Promise<void>;
  /** A file's bytes (null if it isn't there). */
  readBytes(path: string): Promise<Uint8Array | null>;
  /** Save bytes (e.g. a pasted picture) as a brand-new file. Never overwrites. */
  writeBytes(path: string, data: Uint8Array): Promise<void>;
  /** A web address the window can show a picture or video from (null if it can't). */
  fileUrl(path: string): Promise<string | null>;
  open(path: string): Promise<void>;
  reveal(path: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  /** Choose files to add. `only` limits the choice, e.g. just pictures. */
  pickFiles(only?: { name: string; extensions: string[] }): Promise<string[]>;
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
