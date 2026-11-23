// The store: every action the screens can take (create, save, rename, attach,
// link, delete). Each action writes to the files first, then rereads the
// folder, so what you see is always what's on disk.

import type { BoardCard, Entry, FieldDef, Item, ModuleDef } from "./types";
import type { Storage } from "./storage";
import { DEFAULT_MODULES, applyOverrides, type ModuleOverrides } from "./modules";
import { LifeIndex } from "./index";
import { serializeItem } from "./notes";
import { dateFromName, mediaLine } from "./journal";
import { FOLDER_MOVES, OLD_CATEGORY_FOLDERS } from "./reorganize";
import { parseNote } from "./notability";
import { newId } from "./ids";
import {
  ALL_PART_KEYS,
  DOCS_FILE,
  DOCS_KEY,
  MAIN_FILE,
  MAIN_TEMPLATE,
  MODULES_FOLDER,
  OVERVIEW_KEY,
  OVERVIEW_TEMPLATE,
  SECTIONS,
  docsTemplate,
  hasLeanCanvas,
  moduleTemplate,
  type PartKey,
} from "./projects";
import {
  datePrefix,
  dirName,
  extName,
  fileName,
  isNote,
  isBoardFile,
  BOARD_FILE,
  projectFile,
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
    // First, move any folders from the old layout to their new places (before new folders are made).
    await this.reorganizeFolders();
    // Every app's folder exists from day one, so the whole structure shows in Finder.
    for (const m of this.modules) {
      await this.storage.mkdir(m.folder);
      for (const section of m.sections ?? []) await this.storage.mkdir(`${m.folder}/${section}`);
    }
    await this.rescan();
    await this.upgradeOldProjects();
    await this.markCoursesCompletedOnce();
    this.unwatch?.();
    this.unwatch = this.storage.onChange(() => this.scheduleRescan());
    this.ready = true;
    this.bump();
  }

  /** What the last folder reorganization did when LifeOS opened (also saved in LifeOS/.lifeos/folder-moves.log). */
  moveLog: string[] = [];

  /**
   * Move each old folder to its new place (see `FOLDER_MOVES`): the whole folder, never a copy, and only if the
   * new one doesn't exist yet, so files, note ids and links are untouched. Then remove an old category folder
   * only if it ended up completely empty. Everything it does is logged.
   */
  private async reorganizeFolders() {
    const lines: string[] = [];
    const say = (text: string) => lines.push(`${nowStamp()}  ${text}`);
    for (const { from, to } of FOLDER_MOVES) {
      try {
        if (!(await this.storage.exists(from))) continue;
        if (from.startsWith(to + "/")) {
          await this.liftOutOfParent(from, to, say);
        } else if (await this.storage.exists(to)) {
          say(`left "${from}" where it is, because "${to}" already exists`);
        } else {
          await this.storage.renameDir(from, to);
          say(`moved "${from}" to "${to}"`);
        }
      } catch (e) {
        say(`could not move "${from}" to "${to}": ${e}`);
      }
    }
    for (const dir of OLD_CATEGORY_FOLDERS) {
      try {
        if (!(await this.storage.exists(dir))) continue;
        say((await this.storage.removeEmptyDir(dir)) ? `removed the empty folder "${dir}"` : `kept "${dir}", it still has something in it`);
      } catch (e) {
        say(`could not check "${dir}": ${e}`);
      }
    }
    this.moveLog = lines;
    if (!lines.length) return;
    try {
      const file = ".lifeos/folder-moves.log";
      const before = (await this.storage.read(file)) ?? "";
      await this.storage.write(file, before + lines.join("\n") + "\n");
    } catch {
      /* the log is only a convenience */
    }
  }

  /**
   * "Life/Plan" becomes "Life", but "Life" is its parent. Move the parent aside, move "Plan" up into its place,
   * and remove the old parent only if nothing is left in it. Puts everything back if a step fails.
   */
  private async liftOutOfParent(from: string, to: string, say: (t: string) => void) {
    const aside = `${to} (old)`;
    if (await this.storage.exists(aside)) {
      say(`left "${from}" where it is, because "${aside}" already exists`);
      return;
    }
    await this.storage.renameDir(to, aside);
    try {
      await this.storage.renameDir(`${aside}/${from.slice(to.length + 1)}`, to);
    } catch (e) {
      await this.storage.renameDir(aside, to);
      throw e;
    }
    say(`moved "${from}" to "${to}"`);
    say((await this.storage.removeEmptyDir(aside)) ? `removed the empty folder "${aside}"` : `kept "${aside}", it still has something in it`);
  }

  /**
   * One time only: everything already in Courses is marked Completed (the owner's choice). A marker file
   * in LifeOS/.lifeos remembers it was done, so courses added later keep whatever status they're given.
   */
  private async markCoursesCompletedOnce() {
    const marker = ".lifeos/courses-status-completed";
    if (await this.storage.exists(marker)) return;
    const mod = this.module("courses");
    if (!mod) return;
    try {
      await this.run(async () => {
        for (const i of this.index.inModule("courses")) {
          if (i.fields["Status"] === "Completed") continue;
          await this.writeNote(i.path, serializeItem({ ...i, fields: { ...i.fields, Status: "Completed" } }, mod));
        }
        await this.rescanNow();
      });
      await this.storage.write(marker, "Courses were marked Completed once.\n");
    } catch {
      /* try again next time LifeOS opens */
    }
  }

  /** Projects made before the .lifeos file existed become one "<name>.lifeos" file as soon as LifeOS opens. */
  private async upgradeOldProjects() {
    for (const p of this.index.projects()) {
      if (p.path.endsWith(".lifeos")) continue;
      try {
        await this.run(async () => {
          const fresh = this.index.items.get(p.id);
          if (!fresh || fresh.path.endsWith(".lifeos")) return;
          const dir = dirName(fresh.path);
          const newPath = join(dir, uniqueName(stripExt(projectFile(fileName(dir))), ".lifeos", this.taken(dir, fresh.path)));
          await this.storage.move(fresh.path, newPath);
          this.cache.delete(fresh.path);
          await this.trashOldBoard(dir);
          // Keep the Board that was in projectboard.lifeos by writing it into the new file.
          await this.writeNote(newPath, serializeItem({ ...fresh, path: newPath }, this.projectsModule()));
          await this.rescanNow();
        });
      } catch {
        /* leave this one as it is; it will upgrade the next time it is saved */
      }
    }
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
    const notes = entries.filter((e) => isNote(e.path) || isBoardFile(e.path));
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

  /** Renaming a course that holds others (or a lesson) renames its folder too, so what's inside stays attached. */
  private async renameCourseFolderNow(input: Item): Promise<Item> {
    const mod = this.projectsLike("courses");
    const old = this.index.items.get(input.id) ?? input;
    const oldDir = dirName(old.path);
    const parentDir = dirName(oldDir);
    const oldName = fileName(oldDir);
    let name = safeName(input.title);
    let newDir = oldDir;
    let path = old.path;
    if (name !== oldName) {
      name = uniqueName(name, "", (n) => this.dirTaken(join(parentDir, n)));
      newDir = join(parentDir, name);
      await this.storage.renameDir(oldDir, newDir);
      await this.storage.move(join(newDir, `${oldName}.md`), join(newDir, `${name}.md`));
      path = join(newDir, `${name}.md`);
      for (const p of [...this.cache.keys()]) if (p.startsWith(oldDir + "/")) this.cache.delete(p);
    }
    const rel = newDir.slice(mod.folder.length).replace(/^\//, "");
    const item: Item = { ...input, path, folder: rel, updated: nowStamp(), created: input.created || today() };
    await this.writeNote(path, serializeItem(item, mod));
    await this.rescanNow();
    return this.index.items.get(item.id) ?? item;
  }

  private async saveNow(input: Item, rename: boolean): Promise<Item> {
    if (rename && input.module === "courses" && this.index.isCourseFolder(this.index.items.get(input.id) ?? input)) {
      return this.renameCourseFolderNow(input);
    }
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
    if (item.kind === "project") await this.upgradeProjectFile(item);
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
  private async writeParts(project: Item, parts: PartKey[] = ALL_PART_KEYS, mainBody?: string) {
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
    await this.writeMainNow(project, rel, mainBody);
  }

  /**
   * Every project has a details file, `main.md`. If the project has none yet it is made from what the
   * project already holds (the older Overview text), or from a short template. A plain `main.md` already
   * in the folder is kept as it is and just marked as the details file. Nothing is deleted.
   */
  private async writeMainNow(project: Item, rel: string, mainBody?: string) {
    const mod = this.projectsModule();
    const path = join(dirName(project.path), `${MAIN_FILE}.md`);
    const existing = this.index.byPath.get(path);
    if (existing) {
      if (existing.kind !== "main") {
        const adopted: Item = { ...existing, kind: "main", title: "Main", hasId: true, id: existing.hasId ? existing.id : newId(), updated: nowStamp() };
        await this.writeNote(path, serializeItem(adopted, mod));
      }
      return;
    }
    if (this.index.entries.some((e) => e.path === path)) return;
    const body = mainBody ?? (project.body.trim() ? project.body : MAIN_TEMPLATE);
    await this.writeNote(path, serializeItem(this.blankItem(mod.id, "main", "Main", path, body, rel), mod));
  }

  /** Make sure a project has its main.md (older projects get one the first time they open). */
  async ensureMain(project: Item): Promise<void> {
    const fresh = this.index.items.get(project.id) ?? project;
    if (this.index.partsOf(fresh).main) return;
    return this.run(async () => {
      const again = this.index.items.get(project.id) ?? fresh;
      if (this.index.partsOf(again).main) return;
      const mod = this.projectsModule();
      const rel = dirName(again.path).slice(mod.folder.length).replace(/^\//, "");
      await this.writeMainNow(again, rel);
      await this.rescanNow();
    });
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
      const mainBody = parts.includes(OVERVIEW_KEY) ? OVERVIEW_TEMPLATE : MAIN_TEMPLATE;
      const main = this.blankItem(mod.id, "project", title.trim() || name, join(dir, projectFile(name)), "", rel);
      main.fields = { Status: "Idea", ...fields };
      await this.writeNote(main.path, serializeItem(main, mod));
      this.index.entries.push({ path: main.path, mtime: Date.now(), size: 0 });
      await this.writeParts(main, parts, mainBody);
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
      // The lean canvas goes into main.md (an older project without one keeps it in its own text).
      const target = this.index.partsOf(fresh).main ?? fresh;
      if (hasLeanCanvas(target.body)) return;
      const body = target.body.trim() ? `${target.body.trim()}\n\n${OVERVIEW_TEMPLATE}` : OVERVIEW_TEMPLATE;
      await this.saveItem({ ...target, body });
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

  /** Make a new, empty Markdown page in the project folder (named what you typed) and put it on the Board. */
  async createBoardMarkdown(project: Item, title: string, at: { x: number; y: number }): Promise<Item> {
    return this.run(async () => {
      const fresh = this.index.items.get(project.id) ?? project;
      const dir = dirName(fresh.path);
      const name = uniqueName(safeName(title.trim().replace(/\.(md|markdown)$/i, "")) || "Untitled", ".md", this.taken(dir));
      await this.storage.write(join(dir, name), `# ${stripExt(name)}\n\n`);
      this.index.entries.push({ path: join(dir, name), mtime: Date.now(), size: 0 });
      const board = [...(fresh.board ?? []), { id: newId(), type: "file" as const, file: name, x: Math.round(at.x), y: Math.round(at.y), w: 300 }];
      return this.saveNow({ ...fresh, files: [...fresh.files, name], board }, false);
    });
  }

  // ---------- Journal: one folder per day ----------
  /** The day's text page, "Journal/2026-11-11/2026-11-11.md". Makes the day if it isn't there yet. */
  async openJournalDay(date: string): Promise<Item> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pick a date.");
    return this.run(() => this.openDayNow(date));
  }

  /** A day (named by its date) or, for notes with no date in their title, an entry named by its title. */
  private async openDayNow(date: string): Promise<Item> {
    const mod = this.module("journal");
    if (!mod) throw new Error("The Journal app isn't available.");
    const path = join(mod.folder, date, `${date}.md`);
    const existing = this.index.byPath.get(path);
    if (existing) return existing;
    const item = this.blankItem(mod.id, "", date, path, "", date);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) item.fields = { Date: date };
    await this.writeNote(path, serializeItem(item, mod));
    await this.rescanNow();
    return this.index.items.get(item.id) ?? item;
  }

  /** For a note with no date in its title: its title as a folder name, "Title 2" if a different entry already has it. */
  private freeEntryName(title: string, text: string): string {
    const base = safeName(title);
    const folder = this.module("journal")?.folder ?? "Journal";
    for (let n = 1; ; n++) {
      const name = n === 1 ? base : `${base} ${n}`;
      const existing = this.index.byPath.get(join(folder, name, `${name}.md`));
      if (!existing || (text && existing.body.includes(text.slice(0, 200)))) return name;
    }
  }

  /**
   * Bring in Notability entries (.note files). Each one becomes a Journal day: the typed text
   * becomes the day's writing, and any pictures or recordings become files in the day's folder.
   * The day comes only from the date in the note's title (e.g. "Oct 4, 2026"); a title with no date is used as the entry's name instead. The .note file itself moves to LifeOS/.trash when it has been read.
   */
  async importNoteFiles(absPaths: string[]): Promise<{ imported: number; problems: string[] }> {
    return this.run(async () => {
      let imported = 0;
      const problems: string[] = [];
      for (const abs of absPaths) {
        const orig = abs.split(/[\\/]/).pop() || "note";
        if (extName(orig).toLowerCase() !== ".note") {
          problems.push(`${orig}: not a Notability .note file, left where it is`);
          continue;
        }
        // Move it into LifeOS first (nothing outside the folder is ever read), then read it there.
        const staged = join("Journal/.import", uniqueName(safeName(stripExt(orig)), ".note", this.taken("Journal/.import")));
        await this.storage.importFile(abs, staged);
        this.index.entries.push({ path: staged, mtime: Date.now(), size: 0 });
        try {
          const bytes = await this.storage.readBytes(staged);
          if (!bytes) throw new Error("couldn't read the file");
          const note = await parseNote(bytes);
          // The day is only ever the date written in the note's title (other dates, like when the
          // file was made, can be a different day). With no date in the title, the title is the name.
          const date = dateFromName(note.title) || this.freeEntryName(note.title || stripExt(orig), note.text.trim());
          if (!note.text.trim() && note.files.length === 0) throw new Error("it has no typed text or pictures (handwriting can't be turned into text)");
          const day = await this.openDayNow(date);
          const dir = dirName(day.path);
          let fresh = this.index.items.get(day.id) ?? day;
          const already = note.text.trim() && fresh.body.includes(note.text.trim().slice(0, 200));
          if (!already) {
            const parts: string[] = [];
            if (note.text.trim()) parts.push(note.text.trim());
            for (const f of note.files) {
              if (f.kind === "pdf") continue;
              const name = uniqueName(safeName(stripExt(f.name)), extName(f.name).toLowerCase(), this.taken(dir));
              await this.storage.writeBytes(join(dir, name), f.data);
              this.index.entries.push({ path: join(dir, name), mtime: Date.now(), size: f.data.length });
              parts.push(mediaLine(name));
            }
            for (const f of note.files) {
              if (f.kind !== "pdf") continue;
              const name = uniqueName(safeName(stripExt(f.name)), ".pdf", this.taken(dir));
              await this.storage.writeBytes(join(dir, name), f.data);
              this.index.entries.push({ path: join(dir, name), mtime: Date.now(), size: f.data.length });
            }
            const old = fresh.body.trimEnd();
            await this.saveNow({ ...fresh, body: [old, ...parts].filter(Boolean).join("\n\n") + "\n" }, false);
            fresh = this.index.items.get(day.id) ?? fresh;
          }
          const stamp = nowStamp().replace(/[:T]/g, "-");
          let trash = join(".trash", stamp, staged);
          for (let n = 2; await this.storage.exists(trash); n++) trash = join(".trash", stamp, `${stripExt(staged)} ${n}.note`);
          await this.storage.move(staged, trash);
          await this.rescanNow();
          if (already) problems.push(`${orig}: already in the Journal (${date}), not added twice`);
          else imported++;
        } catch (e) {
          const why = e instanceof Error ? e.message : String(e);
          problems.push(`${orig}: ${why}. It's in LifeOS/Journal/.import if you need it back`);
        }
      }
      return { imported, problems };
    });
  }

  /** Move pictures, recordings or any files into the day's folder, keeping their names. */
  async addJournalFiles(day: Item, absPaths: string[]): Promise<void> {
    return this.run(async () => {
      const dir = dirName(day.path);
      for (const abs of absPaths) {
        const orig = abs.split(/[\\/]/).pop() || "file";
        const name = uniqueName(safeName(stripExt(orig)), extName(orig), this.taken(dir));
        await this.storage.importFile(abs, join(dir, name));
        this.index.entries.push({ path: join(dir, name), mtime: Date.now(), size: 0 });
      }
      await this.rescanNow();
    });
  }

  /** Save a pasted picture as its own file in the day's folder and return its name. */
  async addJournalPicture(day: Item, data: Uint8Array, ext: string): Promise<string> {
    return this.run(async () => {
      const dir = dirName(day.path);
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      const base = `pasted ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
      const name = uniqueName(base, ext, this.taken(dir));
      await this.storage.writeBytes(join(dir, name), data);
      this.index.entries.push({ path: join(dir, name), mtime: Date.now(), size: data.length });
      await this.rescanNow();
      return name;
    });
  }

  /** Move one file from a day to LifeOS/.trash. */
  async removeJournalFile(day: Item, name: string): Promise<void> {
    return this.run(async () => {
      const p = join(dirName(day.path), name);
      if (await this.storage.exists(p)) {
        const stamp = nowStamp().replace(/[:T]/g, "-");
        await this.storage.move(p, join(".trash", stamp, p));
      }
      await this.rescanNow();
    });
  }

  /** Move a whole day (its text, pictures and recordings) to LifeOS/.trash. */
  async deleteJournalDay(day: Item): Promise<void> {
    return this.run(async () => {
      const dir = dirName(day.path);
      const stamp = nowStamp().replace(/[:T]/g, "-");
      const base = join(".trash", stamp, dir);
      let target = base;
      for (let n = 2; await this.storage.exists(target); n++) target = `${base} ${n}`;
      await this.storage.renameDir(dir, target);
      for (const p of [...this.cache.keys()]) if (p.startsWith(dir + "/")) this.cache.delete(p);
      await this.rescanNow();
    });
  }

  // ---------- Courses: a program holds several courses (its parts) ----------
  /** Move a course into its own folder ("<Name>/<Name>.md") so courses can sit inside it. Its files go with it. */
  private async makeCourseFolderNow(course: Item): Promise<Item> {
    const fresh = this.index.items.get(course.id) ?? course;
    if (this.index.isCourseFolder(fresh)) return fresh;
    const mod = this.projectsLike("courses");
    const dir = dirName(fresh.path);
    const name = uniqueName(stripExt(fileName(fresh.path)), "", (n) => this.dirTaken(join(dir, n)));
    const newDir = join(dir, name);
    const newPath = join(newDir, `${name}.md`);
    await this.storage.mkdir(newDir);
    await this.storage.move(fresh.path, newPath);
    for (const f of fresh.files) {
      const from = join(dir, f);
      if (await this.storage.exists(from)) await this.storage.move(from, join(newDir, f));
    }
    this.cache.delete(fresh.path);
    const rel = newDir.slice(mod.folder.length).replace(/^\//, "");
    await this.writeNote(newPath, serializeItem({ ...fresh, path: newPath, folder: rel }, mod));
    await this.rescanNow();
    return this.index.items.get(fresh.id) ?? fresh;
  }

  private projectsLike(id: string): ModuleDef {
    const mod = this.module(id);
    if (!mod) throw new Error(`Unknown app: ${id}`);
    return mod;
  }

  /** A course inside a program: a folder of its own, "<Program>/<Course>/<Course>.md", so its files and lessons sit together. */
  private async addProgramCourseNow(programDir: string, title: string, instructor = "", provider = "", status = ""): Promise<Item> {
    const mod = this.projectsLike("courses");
    const name = uniqueName(safeName(title), "", (n) => this.dirTaken(join(programDir, n)));
    const path = join(programDir, name, `${name}.md`);
    const rel = join(programDir, name).slice(mod.folder.length).replace(/^\//, "");
    const course = this.blankItem(mod.id, "", title.trim() || name, path, "", rel);
    const n = this.programChildren(programDir).reduce((m, i) => Math.max(m, Number(i.fields["Part"]) || 0), 0) + 1;
    course.fields = { ...(instructor ? { Instructor: instructor } : {}), ...(provider ? { Provider: provider } : {}), ...(status ? { Status: status } : {}), Part: n };
    await this.writeNote(path, serializeItem(course, mod));
    this.index.entries.push({ path, mtime: Date.now(), size: 0 });
    await this.rescanNow();
    return this.index.byPath.get(path) ?? course;
  }

  /** Add a course to a program (a folder in Courses). */
  async addCourseToProgram(programDir: string, title: string, instructor = ""): Promise<Item> {
    return this.run(() => this.addProgramCourseNow(programDir, title, instructor));
  }

  /** Make a new program with its first course. A program is just a folder, so it needs a course to exist. */
  async createProgram(name: string, firstCourse: string, instructor = ""): Promise<Item> {
    return this.run(async () => {
      const mod = this.projectsLike("courses");
      const dir = join(mod.folder, uniqueName(safeName(name), "", (n) => this.dirTaken(join(mod.folder, n))));
      return this.addProgramCourseNow(dir, firstCourse, instructor);
    });
  }

  /** Rename a program's folder. Everything inside goes with it. Returns the new folder. */
  async renameProgram(dir: string, newName: string): Promise<string> {
    return this.run(async () => {
      const mod = this.projectsLike("courses");
      const name = safeName(newName);
      if (name === fileName(dir)) return dir;
      const target = join(mod.folder, uniqueName(name, "", (n) => this.dirTaken(join(mod.folder, n))));
      await this.storage.renameDir(dir, target);
      for (const p of [...this.cache.keys()]) if (p.startsWith(dir + "/")) this.cache.delete(p);
      await this.rescanNow();
      return target;
    });
  }

  /** Add a lesson to a course. A lesson is a page in a folder of its own, so its classes sit together. */
  async addCourseLesson(course: Item, title: string): Promise<Item> {
    return this.run(() => this.addChildNow(course, "lesson", title));
  }

  /** Add a class to a lesson. A class is a folder of its own too; it is where the notes and files go. */
  async addCourseClass(lesson: Item, title: string): Promise<Item> {
    return this.run(() => this.addChildNow(lesson, "class", title));
  }

  private async addChildNow(parent: Item, kind: "lesson" | "class", title: string, status = ""): Promise<Item> {
    {
      const mod = this.projectsLike("courses");
      const program = await this.makeCourseFolderNow(parent);
      const dir = dirName(program.path);
      const name = uniqueName(safeName(title), "", (n) => this.dirTaken(join(dir, n)));
      const path = join(dir, name, `${name}.md`);
      const rel = join(dir, name).slice(mod.folder.length).replace(/^\//, "");
      const child = this.blankItem(mod.id, kind, title.trim() || name, path, "", rel);
      const n = this.index.courseParts(program).filter((i) => i.kind === kind).reduce((m, i) => Math.max(m, Number(i.fields["Part"]) || 0), 0) + 1;
      child.fields = { ...(status ? { Status: status } : {}), Part: n };
      await this.writeNote(path, serializeItem(child, mod));
      this.index.entries.push({ path, mtime: Date.now(), size: 0 });
      await this.rescanNow();
      return this.index.byPath.get(path) ?? child;
    }
  }

  /**
   * Add a certificate (a PDF or picture) to a course or a program folder. It is moved in as "Certificate.<ext>"
   * (never overwriting: "Certificate 2" if one is already there). A course on its own gets its own folder first.
   */
  async addCertificate(target: { course: Item } | { programDir: string }, absPath: string): Promise<void> {
    return this.run(async () => {
      let dir: string;
      if ("programDir" in target) dir = target.programDir;
      else {
        let c = this.index.items.get(target.course.id) ?? target.course;
        if (!this.index.isCourseFolder(c) && !this.index.courseParent(c)) c = await this.makeCourseFolderNow(c);
        dir = dirName(c.path);
      }
      const orig = absPath.split(/[\\/]/).pop() || "Certificate";
      const name = uniqueName("Certificate", extName(orig), this.taken(dir));
      await this.storage.importFile(absPath, join(dir, name));
      this.index.entries.push({ path: join(dir, name), mtime: Date.now(), size: 0 });
      if ("course" in target) {
        const c = this.index.items.get(target.course.id) ?? target.course;
        await this.saveNow({ ...c, fields: { ...c.fields, Certification: "Yes" } }, false);
      }
    });
  }

  /**
   * Add files of any kind to a course or lesson: each is moved into its folder under its own name and
   * listed on the page. A course on its own gets its own folder first, so its files sit together.
   */
  async addCourseFiles(course: Item, absPaths: string[]): Promise<number> {
    return this.run(async () => {
      let c = this.index.items.get(course.id) ?? course;
      if (!this.index.isCourseFolder(c) && !this.index.courseParent(c)) c = await this.makeCourseFolderNow(c);
      const dir = dirName(c.path);
      const files = [...c.files];
      for (const abs of absPaths) {
        const orig = abs.split(/[\\/]/).pop() || "file";
        const name = uniqueName(safeName(stripExt(orig)), extName(orig), this.taken(dir));
        await this.storage.importFile(abs, join(dir, name));
        this.index.entries.push({ path: join(dir, name), mtime: Date.now(), size: 0 });
        files.push(name);
      }
      await this.saveNow({ ...c, files }, false);
      return absPaths.length;
    });
  }

  /** Put a loose file into a course or lesson: it moves into that folder and is listed on its page. */
  async moveLooseFileToCourse(filePath: string, courseId: string): Promise<void> {
    return this.run(async () => {
      const course = this.index.items.get(courseId);
      if (!course) throw new Error("That course isn't there anymore.");
      let c = course;
      if (!this.index.isCourseFolder(c) && !this.index.courseParent(c)) c = await this.makeCourseFolderNow(c);
      const dir = dirName(c.path);
      if (dirName(filePath) === dir) return;
      const name = uniqueName(safeName(stripExt(fileName(filePath))), extName(filePath), this.taken(dir));
      await this.storage.move(filePath, join(dir, name));
      this.index.entries = this.index.entries.filter((e) => e.path !== filePath);
      this.index.entries.push({ path: join(dir, name), mtime: Date.now(), size: 0 });
      await this.saveNow({ ...c, files: [...c.files, name] }, false);
    });
  }

  /** The course folders inside a program folder, whether or not the program still has a page of its own. */
  private programChildren(dir: string): Item[] {
    const page = this.index.byPath.get(join(dir, `${fileName(dir)}.md`));
    return page ? this.index.courseParts(page) : this.index.programCourses(dir);
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
      // Arrows that joined this card go with it.
      const board = (fresh.board ?? []).filter((c) => c.id !== card.id && !(c.type === "arrow" && (c.from === card.id || c.to === card.id)));
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
      const wanted = join(newDir, projectFile(name));
      if (path !== wanted) {
        await this.storage.move(path, wanted);
        path = wanted;
      }
      await this.trashOldBoard(newDir);
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
        const newPath = join(dir, projectFile(fileName(dir)));
        await this.storage.move(note.path, newPath);
        this.cache.delete(note.path);
        main.path = newPath;
        await this.writeNote(main.path, serializeItem(main, mod));
        await this.writeParts(main);
        await this.rescanNow();
        return this.index.items.get(main.id) ?? main;
      });
    }
    const project = await this.createProject(note.title, note.folder, note.fields);
    const mainNote = this.index.partsOf(project).main;
    if (mainNote && note.body.trim()) await this.saveItem({ ...mainNote, body: `${note.body.trim()}\n\n${mainNote.body}` });
    const saved = await this.saveItem({ ...(this.index.items.get(project.id) ?? project), tags: note.tags, links: note.links });
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
  /** Older projects: the note was "<Name>.md" with the Board in projectboard.lifeos. Make it one "<name>.lifeos" file. */
  private async upgradeProjectFile(project: Item) {
    const dir = dirName(project.path);
    if (!project.path.endsWith(".lifeos")) {
      const newPath = join(dir, uniqueName(stripExt(projectFile(fileName(dir))), ".lifeos", this.taken(dir, project.path)));
      await this.storage.move(project.path, newPath);
      this.cache.delete(project.path);
      project.path = newPath;
    }
    await this.trashOldBoard(dir);
  }

  private async trashOldBoard(dir: string) {
    const old = join(dir, BOARD_FILE);
    if (!(await this.storage.exists(old))) return;
    const stamp = nowStamp().replace(/[:T]/g, "-");
    await this.storage.move(old, join(".trash", stamp, old));
    this.cache.delete(old);
  }

  private async writeNote(path: string, text: string) {
    await this.storage.write(path, text);
    this.cache.delete(path);
  }

  folderOf(item: Item) {
    return dirName(item.path);
  }
}
