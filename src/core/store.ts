// The store: every action the screens can take (create, save, rename, attach,
// link, delete). Each action writes to the files first, then rereads the
// folder, so what you see is always what's on disk.

import type { BoardCard, Entry, FieldDef, Item, ModuleDef } from "./types";
import type { Storage } from "./storage";
import { DEFAULT_MODULES, applyOverrides, type ModuleOverrides } from "./modules";
import { LifeIndex } from "./index";
import { serializeItem } from "./notes";
import { newId } from "./ids";
import {
  ALL_PART_KEYS,
  DOCS_FILE,
  DOCS_KEY,
  MODULES_FOLDER,
  OVERVIEW_KEY,
  OVERVIEW_TEMPLATE,
  SECTIONS,
  docsTemplate,
  moduleTemplate,
  type PartKey,
} from "./projects";
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
    // Every app's folder exists from day one, so the whole structure shows in Finder.
    for (const m of this.modules) await this.storage.mkdir(m.folder);
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
        kind: "",
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
        kind: "",
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

  // ---------- projects ----------
  private projectsModule(): ModuleDef {
    const mod = this.module("projects");
    if (!mod) throw new Error("The Projects app is missing");
    return mod;
  }

  private blankItem(module: string, kind: string, title: string, path: string, body: string, folder: string): Item {
    return {
      id: newId(),
      hasId: true,
      module,
      kind,
      title,
      path,
      folder,
      fields: {},
      tags: [],
      links: [],
      files: [],
      body,
      created: today(),
      updated: nowStamp(),
    };
  }

  private dirTaken(dir: string) {
    const prefix = dir + "/";
    return this.index.entries.some((e) => e.path.startsWith(prefix));
  }

  /** Write the chosen Venture sections / Documentation page, if the project doesn't have them yet. */
  private async writeParts(project: Item, parts: PartKey[] = ALL_PART_KEYS) {
    const mod = this.projectsModule();
    const dir = dirName(project.path);
    const rel = dir.slice(mod.folder.length).replace(/^\//, "");
    const have = new Set(this.index.entries.map((e) => e.path));
    for (const s of SECTIONS) {
      if (!parts.includes(s.file)) continue;
      const path = join(dir, `${s.file}.md`);
      if (have.has(path)) continue;
      await this.writeNote(path, serializeItem(this.blankItem(mod.id, "section", s.title, path, s.template, rel), mod));
    }
    const docsPath = join(dir, `${DOCS_FILE}.md`);
    if (parts.includes(DOCS_KEY) && !have.has(docsPath)) {
      const docs = this.blankItem(mod.id, "docs", "Documentation", docsPath, docsTemplate(today()), rel);
      await this.writeNote(docsPath, serializeItem(docs, mod));
    }
  }

  /**
   * Create a project folder. Every project has a Board; `parts` picks which of
   * the Overview, Venture sections, Deck and Documentation it also gets.
   */
  async createProject(
    title: string,
    parentFolder = "",
    fields: Record<string, unknown> = {},
    parts: PartKey[] = ALL_PART_KEYS,
  ): Promise<Item> {
    return this.run(async () => {
      const mod = this.projectsModule();
      const parentDir = join(mod.folder, safeFolder(parentFolder));
      const name = uniqueName(safeName(title), "", (n) => this.dirTaken(join(parentDir, n)));
      const dir = join(parentDir, name);
      const rel = dir.slice(mod.folder.length).replace(/^\//, "");
      const body = parts.includes(OVERVIEW_KEY) ? OVERVIEW_TEMPLATE : "";
      const main = this.blankItem(mod.id, "project", title.trim() || name, join(dir, `${name}.md`), body, rel);
      main.fields = { Status: "Idea", ...fields };
      await this.writeNote(main.path, serializeItem(main, mod));
      this.index.entries.push({ path: main.path, mtime: Date.now(), size: 0 });
      await this.writeParts(main, parts);
      await this.rescanNow();
      return this.index.items.get(main.id) ?? main;
    });
  }

  async addMissingSections(project: Item): Promise<void> {
    return this.run(async () => {
      await this.writeParts(project);
      await this.rescanNow();
    });
  }

  /** Add one part (Overview, a Venture section, Deck or Documentation) to an existing project. */
  async addPart(project: Item, part: PartKey): Promise<void> {
    if (part === OVERVIEW_KEY) {
      const fresh = this.index.items.get(project.id) ?? project;
      if (fresh.body.includes("## Lean canvas")) return;
      const body = fresh.body.trim() ? `${fresh.body.trim()}\n\n${OVERVIEW_TEMPLATE}` : OVERVIEW_TEMPLATE;
      await this.saveItem({ ...fresh, body });
      return;
    }
    return this.run(async () => {
      await this.writeParts(project, [part]);
      await this.rescanNow();
    });
  }

  // ---------- the Board ----------
  /** Save the Board's cards (positions, text) into the project note. */
  async saveBoard(project: Item, board: BoardCard[]): Promise<Item> {
    const fresh = this.index.items.get(project.id) ?? project;
    return this.saveItem({ ...fresh, board });
  }

  /**
   * Move files from anywhere on the Mac into the project's folder (keeping their
   * names; " 2" on a clash) and put them on the Board, starting at `at`.
   */
  async addBoardFiles(project: Item, absPaths: string[], at: { x: number; y: number }): Promise<Item> {
    return this.run(async () => {
      const fresh = this.index.items.get(project.id) ?? project;
      const dir = dirName(fresh.path);
      const files = [...fresh.files];
      const board = [...(fresh.board ?? [])];
      let n = 0;
      for (const abs of absPaths) {
        const orig = abs.split(/[\\/]/).pop() || "file";
        const name = uniqueName(safeName(stripExt(orig)), extName(orig), this.taken(dir));
        await this.storage.importFile(abs, join(dir, name));
        this.index.entries.push({ path: join(dir, name), mtime: Date.now(), size: 0 });
        files.push(name);
        board.push({ id: newId(), type: "file", file: name, x: Math.round(at.x + (n % 3) * 280), y: Math.round(at.y + Math.floor(n / 3) * 240), w: 260 });
        n++;
      }
      return this.saveNow({ ...fresh, files, board }, false);
    });
  }

  /** Take a card off the Board. A file card's file goes to LifeOS/.trash (recoverable). */
  async removeBoardCard(project: Item, card: BoardCard): Promise<Item> {
    return this.run(async () => {
      const fresh = this.index.items.get(project.id) ?? project;
      let files = fresh.files;
      if (card?.type === "file" && card.file) {
        const p = join(dirName(fresh.path), card.file);
        if (await this.storage.exists(p)) {
          const stamp = nowStamp().replace(/[:T]/g, "-");
          await this.storage.move(p, join(".trash", stamp, p));
        }
        files = files.filter((f) => f !== card.file);
      }
      const board = (fresh.board ?? []).filter((c) => c.id !== card.id);
      return this.saveNow({ ...fresh, files, board }, false);
    });
  }

  /** Add a module's documentation page (its own build log) inside a project. */
  async addModulePage(project: Item, title: string, appId?: string): Promise<Item> {
    return this.run(async () => {
      const mod = this.projectsModule();
      const dir = join(dirName(project.path), MODULES_FOLDER);
      const path = join(dir, uniqueName(safeName(title), ".md", this.taken(dir)));
      const rel = dir.slice(mod.folder.length).replace(/^\//, "");
      const page = this.blankItem(mod.id, "module", title.trim() || "Untitled", path, moduleTemplate(today()), rel);
      if (appId) page.fields = { App: appId };
      await this.writeNote(path, serializeItem(page, mod));
      await this.rescanNow();
      return this.index.items.get(page.id) ?? page;
    });
  }

  /** Rename a project and/or move it under another folder. Its whole folder moves. */
  async moveProject(project: Item, title: string, parentFolder: string): Promise<Item> {
    return this.run(async () => {
      const mod = this.projectsModule();
      const oldDir = dirName(project.path);
      const parentDir = join(mod.folder, safeFolder(parentFolder));
      const oldName = fileName(oldDir);
      let name = safeName(title);
      let newDir = join(parentDir, name);
      if (newDir === oldDir || newDir.startsWith(oldDir + "/")) {
        if (newDir !== oldDir) throw new Error("A project can't move inside itself.");
      } else {
        name = uniqueName(name, "", (n) => this.dirTaken(join(parentDir, n)));
        newDir = join(parentDir, name);
        await this.storage.renameDir(oldDir, newDir);
      }
      let path = join(newDir, fileName(project.path));
      const wanted = join(newDir, `${name}.md`);
      if (path !== wanted && fileName(project.path) === `${oldName}.md`) {
        await this.storage.move(path, wanted);
        path = wanted;
      }
      for (const p of [...this.cache.keys()]) if (p.startsWith(oldDir + "/")) this.cache.delete(p);
      const rel = newDir.slice(mod.folder.length).replace(/^\//, "");
      const saved: Item = { ...project, title: title.trim() || name, path, folder: rel, updated: nowStamp() };
      await this.writeNote(path, serializeItem(saved, mod));
      await this.rescanNow();
      return this.index.items.get(project.id) ?? saved;
    });
  }

  /**
   * Turn a plain note in Projects into a real project. A note already sitting in a
   * folder named after it ("My Business/My Business.md") becomes a project right
   * there; otherwise a new project folder is made next to it and the text moves in.
   */
  async convertToProject(note: Item): Promise<Item> {
    const dir = dirName(note.path);
    if (fileName(dir) === stripExt(fileName(note.path))) {
      return this.run(async () => {
        const mod = this.projectsModule();
        const main: Item = { ...note, kind: "project", hasId: true, id: note.hasId ? note.id : newId(), updated: nowStamp() };
        main.fields = { Status: "Idea", ...note.fields };
        main.body = note.body.trim() ? `${note.body.trim()}\n\n${OVERVIEW_TEMPLATE}` : OVERVIEW_TEMPLATE;
        main.folder = dir.slice(mod.folder.length).replace(/^\//, "");
        await this.writeNote(main.path, serializeItem(main, mod));
        await this.writeParts(main);
        await this.rescanNow();
        return this.index.items.get(main.id) ?? main;
      });
    }
    const project = await this.createProject(note.title, note.folder, note.fields);
    const body = note.body.trim() ? `${note.body.trim()}\n\n${project.body}` : project.body;
    const saved = await this.saveItem({ ...project, body, tags: note.tags, links: note.links });
    await this.deleteItem(this.index.byPath.get(note.path) ?? note);
    return this.index.items.get(saved.id) ?? saved;
  }

  /** Move a whole project folder (with its sections, modules and sub-projects) to LifeOS/.trash. */
  async deleteProject(project: Item): Promise<void> {
    return this.run(async () => {
      const dir = dirName(project.path);
      const stamp = nowStamp().replace(/[:T]/g, "-");
      await this.storage.renameDir(dir, join(".trash", stamp, dir));
      for (const p of [...this.cache.keys()]) if (p.startsWith(dir + "/")) this.cache.delete(p);
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
