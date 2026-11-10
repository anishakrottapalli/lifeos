// The store: every action the screens can take (create, save, rename, attach,
// link, delete). Each action writes to the files first, then rereads the
// folder, so what you see is always what's on disk.

import type { Entry, FieldDef, Item, ModuleDef } from "./types";
import type { Storage } from "./storage";
import { DEFAULT_MODULES, applyOverrides, type ModuleOverrides } from "./modules";
import { LifeIndex } from "./index";
import { serializeItem } from "./notes";
import { newId } from "./ids";
import {
  datePrefix,
  dirName,
  extName,
  fileName,
  isNote,
  join,
  nowStamp,
  safeFolder,
  safeName,
  stripExt,
  today,
  uniqueName,
} from "./paths";

const MODULES_FILE = ".lifeos/modules.json";

export class LifeStore {
  root = "";
  modules: ModuleDef[] = DEFAULT_MODULES;
  index = new LifeIndex(DEFAULT_MODULES);
  version = 0;
  ready = false;
  error = "";
  private overrides: ModuleOverrides = {};
  private cache = new Map<string, { mtime: number; text: string }>();
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private rescanTimer: ReturnType<typeof setTimeout> | undefined;
  private unwatch: (() => void) | undefined;

  constructor(public storage: Storage) {}

  // ---------- subscription (React reads `version`) ----------
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getVersion = () => this.version;
  private bump() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  /** Run file actions one at a time so they never trip over each other. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => undefined);
    return p;
  }

  // ---------- setup ----------
  async init() {
    try {
      const s = await this.storage.getSettings();
      await this.openRoot(s.root || "");
    } catch (e) {
      this.error = String(e);
      this.bump();
    }
  }

  async openRoot(root: string) {
    this.root = root;
    await this.storage.openRoot(root);
    this.cache.clear();
    await this.loadModules();
    await this.rescan();
    this.unwatch?.();
    this.unwatch = this.storage.onChange(() => this.scheduleRescan());
    this.ready = true;
    this.bump();
  }

  async changeRoot(root: string) {
    await this.storage.saveSettings({ root });
    await this.openRoot(root);
  }

  private async loadModules() {
    const text = await this.storage.read(MODULES_FILE);
    try {
      this.overrides = text ? (JSON.parse(text) as ModuleOverrides) : {};
    } catch {
      this.overrides = {};
    }
    this.modules = applyOverrides(DEFAULT_MODULES, this.overrides);
    this.index.modules = this.modules;
  }

  module(id: string): ModuleDef | undefined {
    return this.modules.find((m) => m.id === id);
  }

  async saveFields(moduleId: string, fields: FieldDef[]) {
    await this.run(async () => {
      this.overrides.fields = { ...(this.overrides.fields ?? {}), [moduleId]: fields };
      await this.storage.write(MODULES_FILE, JSON.stringify(this.overrides, null, 2) + "\n");
      await this.loadModules();
      await this.rescanNow();
    });
  }

  // ---------- reading the folder ----------
  scheduleRescan() {
    clearTimeout(this.rescanTimer);
    this.rescanTimer = setTimeout(() => {
      this.run(() => this.rescanNow());
    }, 300);
  }

  rescan() {
    return this.run(() => this.rescanNow());
  }

  /** Forget everything cached and reread the whole folder. */
  rebuild() {
    this.cache.clear();
    return this.rescan();
  }

  private async rescanNow() {
    const entries: Entry[] = await this.storage.scan();
    const notes = entries.filter((e) => isNote(e.path));
    const stale = notes.filter((e) => this.cache.get(e.path)?.mtime !== e.mtime);
    if (stale.length) {
      const texts = await this.storage.readMany(stale.map((e) => e.path));
      stale.forEach((e, i) => {
        const t = texts[i];
        if (t !== null && t !== undefined) this.cache.set(e.path, { mtime: e.mtime, text: t });
      });
    }
    const present = new Set(notes.map((e) => e.path));
    for (const p of [...this.cache.keys()]) if (!present.has(p)) this.cache.delete(p);
    const textMap = new Map<string, string>();
    for (const [p, v] of this.cache) textMap.set(p, v.text);
    this.index.build(entries, textMap);
    this.bump();
  }

  // ---------- naming ----------
  private taken(dir: string, exceptPath?: string) {
    const used = new Set(this.index.entries.map((e) => e.path));
    return (name: string) => {
      const p = join(dir, name);
      return p !== exceptPath && used.has(p);
    };
  }

  private baseFor(mod: ModuleDef, item: Pick<Item, "title" | "created">) {
    const prefix = datePrefix(mod.datePrefix, item.created || today());
    const title = safeName(item.title);
    return prefix && !title.startsWith(prefix) ? `${prefix} ${title}` : title;
  }

  // ---------- actions ----------
  async createItem(moduleId: string, title = "Untitled", folder = "", fields: Record<string, unknown> = {}): Promise<Item> {
    return this.run(async () => {
      const mod = this.module(moduleId);
      if (!mod) throw new Error(`Unknown app: ${moduleId}`);
      const item: Item = {
        id: newId(),
        hasId: true,
        module: moduleId,
        title,
        path: "",
        folder: safeFolder(folder),
        fields: { ...fields },
        tags: [],
        links: [],
        files: [],
        body: "",
        created: today(),
        updated: nowStamp(),
      };
      const dir = join(mod.folder, item.folder);
      item.path = join(dir, uniqueName(this.baseFor(mod, item), ".md", this.taken(dir)));
      await this.writeNote(item.path, serializeItem(item, mod));
      await this.rescanNow();
      return this.index.items.get(item.id) ?? item;
    });
  }

  /**
   * Save an item. With `rename`, the note (and its attached files) also move
   * to match the current title and folder.
   */
  async saveItem(item: Item, opts: { rename?: boolean } = {}): Promise<Item> {
    return this.run(() => this.saveNow(item, opts.rename ?? false));
  }

  private async saveNow(input: Item, rename: boolean): Promise<Item> {
    const mod = this.module(input.module);
    if (!mod) throw new Error(`Unknown app: ${input.module}`);
    const item: Item = { ...input, fields: { ...input.fields }, files: [...input.files], links: [...input.links] };
    if (!item.hasId) {
      item.id = newId();
      item.hasId = true;
    }
    if (!item.created) item.created = today();
    item.updated = nowStamp();
    item.folder = safeFolder(item.folder);

    if (rename) {
      const oldPath = item.path;
      const oldDir = dirName(oldPath);
      const oldBase = stripExt(fileName(oldPath));
      const newDir = join(mod.folder, item.folder);
      const wanted = this.baseFor(mod, item);
      const newName = wanted === oldBase && newDir === oldDir ? fileName(oldPath) : uniqueName(wanted, ".md", this.taken(newDir, oldPath));
      const newPath = join(newDir, newName);
      if (newPath !== oldPath) {
        await this.storage.move(oldPath, newPath);
        const newBase = stripExt(newName);
        const files: string[] = [];
        for (const f of item.files) {
          const from = join(oldDir, f);
          const renamed = f.startsWith(oldBase) ? newBase + f.slice(oldBase.length) : f;
          const finalName = uniqueName(stripExt(renamed), extName(renamed), this.taken(newDir, from));
          if (await this.storage.exists(from)) await this.storage.move(from, join(newDir, finalName));
          files.push(finalName);
        }
        item.files = files;
        item.path = newPath;
        this.cache.delete(oldPath);
      }
    }
    await this.writeNote(item.path, serializeItem(item, mod));
    await this.rescanNow();
    return this.index.items.get(item.id) ?? item;
  }

  /** Give an item a permanent id (needed before anything can link to it). */
  async ensureId(item: Item): Promise<string> {
    if (item.hasId) return item.id;
    const saved = await this.saveItem(item);
    return saved.id;
  }

  async addLink(item: Item, target: Item, kind: string): Promise<Item> {
    if (target.id === item.id) return item;
    const toId = await this.ensureId(target);
    const fresh = this.index.byPath.get(item.path) ?? item;
    if (fresh.links.some((l) => l.to === toId && l.kind === kind)) return fresh;
    return this.saveItem({ ...fresh, links: [...fresh.links, { to: toId, kind: kind || "related" }] });
  }

  async removeLink(item: Item, index: number): Promise<Item> {
    const links = item.links.filter((_, i) => i !== index);
    return this.saveItem({ ...item, links });
  }

  /** Move picked files into the item's folder and attach them. */
  async addFiles(item: Item, absPaths: string[]): Promise<Item> {
    return this.run(async () => {
      const dir = dirName(item.path);
      const base = stripExt(fileName(item.path));
      const files = [...item.files];
      for (const abs of absPaths) {
        const orig = abs.split(/[\\/]/).pop() || "file";
        const ext = extName(orig);
        const wanted = files.length === 0 && absPaths.length === 1 ? base : `${base} - ${safeName(stripExt(orig))}`;
        const name = uniqueName(wanted, ext, this.taken(dir));
        await this.storage.importFile(abs, join(dir, name));
        files.push(name);
        this.index.entries.push({ path: join(dir, name), mtime: Date.now(), size: 0 });
      }
      return this.saveNow({ ...item, files }, false);
    });
  }

  async removeFile(item: Item, name: string): Promise<Item> {
    // Detach only; the file stays in the folder (it will show as unfiled).
    return this.saveItem({ ...item, files: item.files.filter((f) => f !== name) });
  }

  /** Turn a loose file (e.g. dropped in through Finder) into an item. */
  async fileLooseFile(moduleId: string, path: string): Promise<Item> {
    return this.run(async () => {
      const mod = this.module(moduleId);
      if (!mod) throw new Error(`Unknown app: ${moduleId}`);
      const dir = dirName(path);
      const name = fileName(path);
      const item: Item = {
        id: newId(),
        hasId: true,
        module: moduleId,
        title: stripExt(name),
        path: join(dir, uniqueName(stripExt(name), ".md", this.taken(dir))),
        folder: dir.slice(mod.folder.length).replace(/^\//, ""),
        fields: {},
        tags: [],
        links: [],
        files: [name],
        body: "",
        created: today(),
        updated: nowStamp(),
      };
      await this.writeNote(item.path, serializeItem(item, mod));
      await this.rescanNow();
      return this.index.items.get(item.id) ?? item;
    });
  }

  /** Delete = move the note and its files into LifeOS/.trash (hidden, recoverable). */
  async deleteItem(item: Item): Promise<void> {
    return this.run(async () => {
      const stamp = nowStamp().replace(/[:T]/g, "-");
      const dir = dirName(item.path);
      await this.storage.move(item.path, join(".trash", stamp, item.path));
      for (const f of item.files) {
        const p = join(dir, f);
        if (await this.storage.exists(p)) await this.storage.move(p, join(".trash", stamp, p));
      }
      this.cache.delete(item.path);
      await this.rescanNow();
    });
  }

  /** Write a note and make sure the next scan rereads it. */
  private async writeNote(path: string, text: string) {
    await this.storage.write(path, text);
    this.cache.delete(path);
  }

  folderOf(item: Item) {
    return dirName(item.path);
  }
}
