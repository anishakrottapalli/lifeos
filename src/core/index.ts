// The index: everything LifeOS knows, rebuilt from the folder at any time.
// It is never the source of truth; the files are.

import type { Entry, Item, ModuleDef } from "./types";
import { BOARD_FILE, dirName, fileName, isBoardFile, isNote, join, stripExt } from "./paths";
import { parseBoardFile, parseItem } from "./notes";

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
  /** Project folder → its project note. */
  private projectByDir = new Map<string, Item>();

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
    this.projectByDir.clear();
    for (const i of this.items.values()) {
      if (i.kind === "project") {
        this.projectByDir.set(dirName(i.path), i);
        // Older projects (still a .md file) kept their Board in projectboard.lifeos.
        if (!i.path.endsWith(".lifeos")) {
          const text = noteText.get(join(dirName(i.path), BOARD_FILE));
          const board = text === undefined ? undefined : parseBoardFile(text);
          if (board) i.board = board;
        }
      }
    }
  }

  // ---------- projects ----------
  projects(): Item[] {
    // Sorted by folder, so a project always comes right before the projects inside it.
    return [...this.projectByDir.values()].sort((a, b) => dirName(a.path).localeCompare(dirName(b.path)));
  }

  /** The project an item belongs to (a project belongs to itself). */
  projectFor(item: Item): Item | undefined {
    if (item.kind === "project") return item;
    let d = dirName(item.path);
    while (d) {
      const p = this.projectByDir.get(d);
      if (p) return p;
      d = dirName(d);
    }
    return undefined;
  }

  /** The project this project sits inside, if any. */
  parentProject(project: Item): Item | undefined {
    let d = dirName(dirName(project.path));
    while (d) {
      const p = this.projectByDir.get(d);
      if (p) return p;
      d = dirName(d);
    }
    return undefined;
  }

  partsOf(project: Item) {
    const sections: Item[] = [];
    const modules: Item[] = [];
    const subprojects: Item[] = [];
    const notes: Item[] = [];
    let docs: Item | undefined;
    for (const i of this.items.values()) {
      if (i.id === project.id || i.module !== project.module) continue;
      if (i.kind === "project") {
        if (this.parentProject(i)?.id === project.id) subprojects.push(i);
        continue;
      }
      if (this.projectFor(i)?.id !== project.id) continue;
      if (i.kind === "section") sections.push(i);
      else if (i.kind === "docs" && !docs) docs = i;
      else if (i.kind === "module") modules.push(i);
      else notes.push(i);
    }
    const byFile = (a: Item, b: Item) => fileName(a.path).localeCompare(fileName(b.path));
    sections.sort(byFile);
    modules.sort((a, b) => a.title.localeCompare(b.title));
    subprojects.sort((a, b) => a.title.localeCompare(b.title));
    notes.sort((a, b) => a.title.localeCompare(b.title));
    return { sections, docs, modules, subprojects, notes };
  }

  /** Plain notes in Projects that aren't part of any project (e.g. made before projects had folders). */
  looseProjectNotes(): Item[] {
    return [...this.items.values()].filter((i) => i.module === "projects" && !i.kind && !this.projectFor(i));
  }

  /** How many things an app holds (for Projects: projects, not their sections). */
  countFor(moduleId: string): number {
    if (moduleId === "projects") return this.projectByDir.size;
    return this.inApp(moduleId).length;
  }

  /** The app a module is shown in: the app it is folded into, or itself. */
  hostId(moduleId: string): string {
    return this.module(moduleId)?.foldedInto ?? moduleId;
  }

  /** An app and every app folded into it (Wisdom Drops also holds Quotes & Tweets). */
  appModuleIds(appId: string): string[] {
    return [appId, ...this.modules.filter((m) => m.foldedInto === appId).map((m) => m.id)];
  }

  /** Everything an app shows: its own notes plus the notes of the apps folded into it. */
  inApp(appId: string): Item[] {
    const ids = new Set(this.appModuleIds(appId));
    return [...this.items.values()]
      .filter((i) => ids.has(i.module))
      .sort((a, b) => (b.updated || "").localeCompare(a.updated || "") || a.title.localeCompare(b.title));
  }

  /** "LifeOS › Market Research" for pages inside a project; the plain title otherwise. */
  displayTitle(item: Item): string {
    if (!item.kind || item.kind === "project") return item.title;
    const p = this.projectFor(item);
    return p ? `${p.title} › ${item.title}` : item.title;
  }

  // ---------- courses ----------
  // A course with things inside it (a program's courses, or a course's lessons) is a folder:
  // "<Name>/<Name>.md" with its children beside it (a lesson is a folder of its own, too).
  isCourseFolder(item: Item): boolean {
    const mod = this.module("courses");
    if (!mod || item.module !== "courses") return false;
    const dir = dirName(item.path);
    return dir.startsWith(mod.folder + "/") && stripExt(fileName(item.path)) === fileName(dir);
  }

  /**
   * A program (like "UX Certificate") is only a folder: Courses/<Name>/ with course folders inside and no
   * page of its own. This is the program folder an item sits in, if any.
   */
  programOf(item: Item): string | undefined {
    const mod = this.module("courses");
    if (!mod || item.module !== "courses") return undefined;
    const dir = dirName(item.path);
    const p = this.isCourseFolder(item) ? dirName(dir) : dir;
    if (dirName(p) !== mod.folder) return undefined;
    if (this.byPath.has(join(p, `${fileName(p)}.md`))) return undefined;
    return p;
  }

  /** Every program folder, A to Z. */
  programs(): string[] {
    const out = new Set<string>();
    for (const i of this.items.values()) {
      const p = this.programOf(i);
      if (p) out.add(p);
    }
    return [...out].sort((a, b) => fileName(a).localeCompare(fileName(b)));
  }

  /** The courses inside a program folder, in the order they were added. */
  programCourses(dir: string): Item[] {
    const order = (i: Item) => (Number(i.fields["Part"]) > 0 ? Number(i.fields["Part"]) : 9999);
    return [...this.items.values()]
      .filter((i) => this.programOf(i) === dir)
      .sort((a, b) => order(a) - order(b) || a.title.localeCompare(b.title));
  }

  /** Is this on the main Courses list (not inside a program or another course)? */
  isTopLevelCourse(item: Item): boolean {
    return !this.courseParent(item) && !this.programOf(item);
  }

  /** "UX Certificate → Front-End Development → 1 - Getting Started": where a course or lesson sits. */
  courseLabel(item: Item): string {
    let top = item;
    const chain = [item.title];
    for (let p = this.courseParent(item); p; p = this.courseParent(p)) {
      chain.unshift(p.title);
      top = p;
    }
    const prog = this.programOf(top);
    if (prog) chain.unshift(fileName(prog));
    return chain.join(" → ");
  }

  /** Every course and lesson a file could be put in, by where it sits, A to Z. */
  courseTargets(): { item: Item; label: string }[] {
    return this.inModule("courses")
      .map((item) => ({ item, label: this.courseLabel(item) }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }

  /** The one course or lesson whose title's words are all in a file's name (the longest title wins), if there is exactly one. */
  suggestCourse(name: string): Item | undefined {
    const words = (x: string) => x.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const have = new Set(words(name.replace(/\.[^.]+$/, "")));
    const hits = this.inModule("courses").filter((i) => words(i.title).length > 0 && words(i.title).every((w) => have.has(w)));
    if (hits.length === 0) return undefined;
    const best = Math.max(...hits.map((i) => words(i.title).length));
    const top = hits.filter((i) => words(i.title).length === best);
    return top.length === 1 ? top[0] : undefined;
  }

  /** "Part 1 of 7" for a course inside a program, "Lesson 2 of 6" for a lesson ("" for anything else). */
  partLabel(item: Item): string {
    if (item.kind === "lesson") {
      const parent = this.courseParent(item);
      if (!parent) return "";
      const all = this.courseParts(parent).filter((c) => c.kind === "lesson");
      const i = all.findIndex((c) => c.id === item.id);
      return i < 0 ? "" : `Lesson ${i + 1} of ${all.length}`;
    }
    const dir = this.programOf(item);
    if (!dir || !this.isCourseFolder(item)) return "";
    const all = this.programCourses(dir).filter((c) => this.isCourseFolder(c));
    const i = all.findIndex((c) => c.id === item.id);
    return i < 0 ? "" : `Part ${i + 1} of ${all.length}`;
  }

  /**
   * The files a course or lesson page shows: the ones it was told about that are still in its folder,
   * plus any other file in its folder (put there in Finder).
   */
  courseFiles(item: Item): { attached: string[]; inFolder: string[] } {
    const dir = dirName(item.path);
    const here = new Set(this.entries.filter((e) => dirName(e.path) === dir).map((e) => fileName(e.path)));
    const attached = item.files.filter((f) => here.has(f));
    if (!this.isCourseFolder(item)) return { attached, inFolder: [] };
    const inFolder = [...here]
      .filter((n) => !isNote(join(dir, n)) && !isBoardFile(join(dir, n)) && !n.startsWith(".") && !attached.includes(n))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return { attached, inFolder };
  }

  /** What sits directly inside a course: its courses and lessons, in the order they were added. */
  courseParts(program: Item): Item[] {
    if (!this.isCourseFolder(program)) return [];
    const dir = dirName(program.path);
    const order = (i: Item) => (Number(i.fields["Part"]) > 0 ? Number(i.fields["Part"]) : 9999);
    return [...this.items.values()]
      .filter(
        (i) =>
          i.module === "courses" &&
          i.id !== program.id &&
          (dirName(i.path) === dir || (this.isCourseFolder(i) && dirName(dirName(i.path)) === dir)),
      )
      .sort((a, b) => order(a) - order(b) || a.title.localeCompare(b.title));
  }

  /** The course this one sits inside (undefined for a top-level course). */
  courseParent(item: Item): Item | undefined {
    const mod = this.module("courses");
    if (!mod || item.module !== "courses") return undefined;
    // A folder's own page belongs to the folder above it; any other page belongs to its own folder.
    const dir = this.isCourseFolder(item) ? dirName(dirName(item.path)) : dirName(item.path);
    if (!dir.startsWith(mod.folder + "/")) return undefined;
    return this.byPath.get(join(dir, `${fileName(dir)}.md`));
  }

  /** The documentation page for one of LifeOS's own apps, if a project has one. */
  docsForApp(appId: string): Item | undefined {
    for (const i of this.items.values()) {
      if (i.kind === "module" && i.fields["App"] === appId) return i;
    }
    return undefined;
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
    const appIds = new Set(this.appModuleIds(moduleId));
    const claimed = new Set<string>();
    // A course or lesson owns its whole folder: every file in it is shown on its page.
    const owned = new Set<string>();
    for (const i of this.items.values()) {
      for (const f of i.files) claimed.add(join(dirName(i.path), f));
      if (this.isCourseFolder(i)) owned.add(dirName(i.path));
    }
    return this.entries.filter(
      (e) =>
        !isNote(e.path) &&
        !isBoardFile(e.path) &&
        appIds.has(moduleForPath(e.path, this.modules)?.id ?? "") &&
        !claimed.has(e.path) &&
        !owned.has(dirName(e.path)) &&
        !fileName(e.path).startsWith(".") &&
        !fileName(e.path).endsWith(".lifeos-tmp"),
    );
  }

  search(q: string, moduleId?: string): Item[] {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const scored: { item: Item; score: number }[] = [];
    for (const item of this.items.values()) {
      if (moduleId && this.hostId(item.module) !== moduleId) continue;
      const title = item.title.toLowerCase();
      const hay = [
        title,
        item.body.toLowerCase(),
        item.tags.join(" ").toLowerCase(),
        Object.values(item.fields).map((v) => String(v ?? "")).join(" ").toLowerCase(),
        item.folder.toLowerCase(),
        (item.board ?? []).map((c) => c.text ?? "").join(" ").toLowerCase(),
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
