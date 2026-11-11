// An in-memory LifeOS folder, used when the screens run in a normal browser
// (previews and tests). Nothing here touches real files.

import type { Storage } from "./storage";
import type { Entry, Settings } from "./types";
import { fileName } from "./paths";

interface MemFile {
  text: string;
  mtime: number;
}

const DEMO: Record<string, string> = {
  "Projects/My Business/Software/LifeOS.md": `---
id: lo-demo-lifeos
module: projects
title: LifeOS
created: 2026-11-10
updated: 2026-11-10T15:30:00
tags: [build]
links:
  - to: lo-demo-business
    kind: part of
Type: Personal build
Status: Active
Division: Software
---

One app, many modules. Files are the truth.
`,
  "Projects/My Business/My Business.md": `---
id: lo-demo-business
module: projects
title: My Business
created: 2026-11-10
updated: 2026-11-10T15:00:00
Type: Business
Status: Active
---

Divisions: Content, Software, Services.
`,
  "Life/Plan/Create a business.md": `---
id: lo-demo-goal
module: life
title: Create a business
created: 2026-11-10
updated: 2026-11-10T14:00:00
links:
  - to: lo-demo-business
    kind: project
Section: Goal
Status: In progress
---
`,
  "Knowledge/Quotes & Tweets/Be the main character.md": `---
id: lo-demo-quote
module: quotes
title: Be the main character
created: 2026-11-10
updated: 2026-11-10T13:00:00
tags: [confidence]
Who said it: Unknown
Source type: Tweet
---

Romanticize your life. You are the main character.
`,
  "Recipes/Chicken Curry.md": `---
id: lo-demo-curry
module: recipes
title: Chicken Curry
created: 2026-11-10
updated: 2026-11-10T12:00:00
tags: [family]
Category: Dinner
Cuisine: Indian
Servings: 4
Favorite: true
---

## Ingredients
- 1 lb chicken

## Steps
1. Cook it with love.
`,
  "Health/Medical/Blood Tests/2026-03 Blood Test.pdf": "%PDF demo",
};

export class MemoryStorage implements Storage {
  kind = "memory" as const;
  files = new Map<string, MemFile>();
  external = new Map<string, string>();
  private listeners = new Set<() => void>();
  private settings: Settings = { root: "/Users/you/Documents/LifeOS" };

  constructor(seed = false) {
    if (seed) {
      let t = Date.now() - 100000;
      for (const [p, text] of Object.entries(DEMO)) this.files.set(p, { text, mtime: t++ });
      this.external.set("/Users/you/Downloads/receipt.pdf", "%PDF");
    }
  }

  private changed() {
    setTimeout(() => this.listeners.forEach((l) => l()), 0);
  }

  async getSettings() {
    return { ...this.settings };
  }
  async saveSettings(s: Settings) {
    this.settings = { ...s };
  }
  async openRoot() {}
  async scan(): Promise<Entry[]> {
    return [...this.files.entries()].map(([path, f]) => ({ path, mtime: f.mtime, size: f.text.length }));
  }
  async readMany(paths: string[]) {
    return paths.map((p) => this.files.get(p)?.text ?? null);
  }
  async read(path: string) {
    return this.files.get(path)?.text ?? null;
  }
  async write(path: string, text: string) {
    this.files.set(path, { text, mtime: Date.now() });
    this.changed();
  }
  async move(from: string, to: string) {
    if (from === to) return;
    const f = this.files.get(from);
    if (!f) throw new Error(`Missing: ${from}`);
    if (this.files.has(to)) throw new Error(`Already exists: ${to}`);
    this.files.delete(from);
    this.files.set(to, { ...f, mtime: Date.now() });
    this.changed();
  }
  async renameDir(from: string, to: string) {
    if (from === to) return;
    if (await this.exists(to)) throw new Error(`Already exists: ${to}`);
    for (const [p, f] of [...this.files.entries()]) {
      if (p.startsWith(from + "/")) {
        this.files.delete(p);
        this.files.set(to + p.slice(from.length), f);
      }
    }
    this.changed();
  }
  async exists(path: string) {
    if (this.files.has(path)) return true;
    for (const k of this.files.keys()) if (k.startsWith(path + "/")) return true;
    return false;
  }
  dirs = new Set<string>();
  async mkdir(path: string) {
    this.dirs.add(path);
  }
  async importFile(fromAbs: string, to: string) {
    const t = this.external.get(fromAbs);
    if (t === undefined) throw new Error(`Missing: ${fromAbs}`);
    if (this.files.has(to)) throw new Error(`Already exists: ${to}`);
    this.external.delete(fromAbs);
    this.files.set(to, { text: t, mtime: Date.now() });
    this.changed();
  }
  async fileUrl() {
    return null;
  }
  async open() {}
  async reveal() {}
  async pickFolder() {
    return null;
  }
  async pickFiles() {
    const picked = [...this.external.keys()];
    return picked.length ? [picked[0]] : [];
  }
  onChange(cb: () => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  /** Test helper: simulate a file dropped in through Finder. */
  dropFile(path: string, text = "") {
    this.files.set(path, { text, mtime: Date.now() });
    this.changed();
  }
  names() {
    return [...this.files.keys()].map(fileName);
  }
}
