// The index: everything LifeOS knows, rebuilt from the folder at any time.
// It is never the source of truth; the files are.

import type { Entry, Item, ModuleDef } from "./types";
import { dirName, fileName, isNote, join } from "./paths";
import { parseItem } from "./notes";

export interface Backlink {
  item: Item;
  kind: string;
}

/** Which app owns a path: the one with the longest matching folder. */
export function moduleForPath(path: string, modules: ModuleDef[]): ModuleDef | undefined {
  let best: ModuleDef | undefined;
  for (const m of modules) {
    if (path === m.folder || path.startsWith(m.folder + "/")) {
      if (!best || m.folder.length > best.folder.length) best = m;
    }
  }
  return best;
}

export class LifeIndex {
  items = new Map<string, Item>();
  byPath = new Map<string, Item>();
  entries: Entry[] = [];
  private back = new Map<string, Backlink[]>();

  constructor(public modules: ModuleDef[]) {}

  module(id: string): ModuleDef | undefined {
    return this.modules.find((m) => m.id === id);
  }

  /** Build from every file in the folder plus the text of the note files. */
  build(entries: Entry[], noteText: Map<string, string>) {
    this.items.clear();
    this.byPath.clear();
    this.entries = entries;
    for (const e of entries) {
      if (!isNote(e.path)) continue;
      const mod = moduleForPath(e.path, this.modules);
      if (!mod) continue;
      const text = noteText.get(e.path);
      if (text === undefined) continue;
      const folder = dirName(e.path).slice(mod.folder.length).replace(/^\//, "");
      const item = parseItem(e.path, text, mod.id, folder);
      // The folder decides the app; a stale "module:" line doesn't override it.
      item.module = mod.id;
      if (this.items.has(item.id)) {
        // Duplicate id (e.g. a file copied in Finder): keep both, by path.
        item.id = `path:${e.path}`;
        item.hasId = false;
      }
      this.items.set(item.id, item);
      this.byPath.set(item.path, item);
    }
    this.buildBacklinks();
  }

  private buildBacklinks() {
    this.back.clear();
    for (const item of this.items.values()) {
      for (const l of item.links) {
        const list = this.back.get(l.to) ?? [];
        list.push({ item, kind: l.kind });
        this.back.set(l.to, list);
      }
    }
  }

  backlinks(id: string): Backlink[] {
    return this.back.get(id) ?? [];
  }

  inModule(moduleId: string): Item[] {
    return [...this.items.values()]
      .filter((i) => i.module === moduleId)
      .sort((a, b) => (b.updated || "").localeCompare(a.updated || "") || a.title.localeCompare(b.title));
  }

  recent(n = 12): Item[] {
    return [...this.items.values()]
      .filter((i) => i.updated)
      .sort((a, b) => b.updated.localeCompare(a.updated))
      .slice(0, n);
  }

  allTags(): string[] {
    const s = new Set<string>();
    for (const i of this.items.values()) i.tags.forEach((t) => s.add(t));
    return [...s].sort((a, b) => a.localeCompare(b));
  }

  subfolders(moduleId: string): string[] {
    const mod = this.module(moduleId);
    if (!mod) return [];
    const s = new Set<string>();
    for (const e of this.entries) {
      if (!e.path.startsWith(mod.folder + "/")) continue;
      let d = dirName(e.path).slice(mod.folder.length).replace(/^\//, "");
      while (d) {
        s.add(d);
        d = dirName(d);
      }
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }

  /** Files in an app's folder that no note claims (e.g. a PDF dropped in through Finder). */
  unfiled(moduleId: string): Entry[] {
    const mod = this.module(moduleId);
    if (!mod) return [];
    const claimed = new Set<string>();
    for (const i of this.items.values()) {
      for (const f of i.files) claimed.add(join(dirName(i.path), f));
    }
    return this.entries.filter(
      (e) =>
        !isNote(e.path) &&
        moduleForPath(e.path, this.modules)?.id === moduleId &&
        !claimed.has(e.path) &&
        !fileName(e.path).endsWith(".lifeos-tmp"),
    );
  }

  search(q: string, moduleId?: string): Item[] {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const scored: { item: Item; score: number }[] = [];
    for (const item of this.items.values()) {
      if (moduleId && item.module !== moduleId) continue;
      const title = item.title.toLowerCase();
      const hay = [
        title,
        item.body.toLowerCase(),
        item.tags.join(" ").toLowerCase(),
        Object.values(item.fields).map((v) => String(v ?? "")).join(" ").toLowerCase(),
        item.folder.toLowerCase(),
      ].join(" \n ");
      if (!words.every((w) => hay.includes(w))) continue;
      let score = 0;
      for (const w of words) {
        if (title.startsWith(w)) score += 5;
        else if (title.includes(w)) score += 3;
        else score += 1;
      }
      scored.push({ item, score });
    }
    return scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title)).map((s) => s.item);
  }
}
