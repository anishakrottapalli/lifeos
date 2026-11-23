import { describe, expect, it } from "vitest";
import { MemoryStorage } from "./storage-memory";
import { LifeStore } from "./store";
import { parseItem, serializeItem, splitFrontmatter } from "./notes";
import { safeFolder, safeName } from "./paths";
import { moduleForPath } from "./index";
import { DEFAULT_MODULES } from "./modules";

async function fresh() {
  const mem = new MemoryStorage(false);
  const store = new LifeStore(mem);
  await store.init();
  return { mem, store };
}

describe("note files", () => {
  it("round-trips fields, tags and links", () => {
    const text = `---
id: lo-1
module: quotes
title: Hello
tags: [a, b]
links:
  - to: lo-2
    kind: source
Who said it: Maya
Favorite: true
---

The quote.
`;
    const item = parseItem("Knowledge/Quotes & Tweets/Hello.md", text, "quotes", "");
    expect(item.id).toBe("lo-1");
    expect(item.tags).toEqual(["a", "b"]);
    expect(item.links).toEqual([{ to: "lo-2", kind: "source" }]);
    expect(item.fields["Who said it"]).toBe("Maya");
    expect(item.body.trim()).toBe("The quote.");
    const again = parseItem(item.path, serializeItem(item), "quotes", "");
    expect(again).toEqual(item);
  });

  it("reads plain Markdown made outside LifeOS", () => {
    const item = parseItem("Recipes/Dal.md", "# Dal\nLentils", "recipes", "");
    expect(item.hasId).toBe(false);
    expect(item.title).toBe("Dal");
    expect(item.body).toContain("Lentils");
  });

  it("keeps broken frontmatter as text instead of losing it", () => {
    const { meta, body } = splitFrontmatter("---\n: : bad [\n---\nhi");
    expect(meta).toEqual({});
    expect(body).toContain("bad");
  });

  it("makes safe names", () => {
    expect(safeName('a/b:c*?"d')).toBe("a b c d");
    expect(safeName("   ")).toBe("Untitled");
    expect(safeFolder(" My Business / ../Software ")).toBe("My Business/Software");
  });

  it("finds the owning app by the longest folder", () => {
    expect(moduleForPath("To-Do & Routines/x.md", DEFAULT_MODULES)?.id).toBe("todo");
    expect(moduleForPath("Life/x.md", DEFAULT_MODULES)?.id).toBe("life");
    expect(moduleForPath("Wisdom Drops/x.md", DEFAULT_MODULES)?.id).toBe("wisdom");
    expect(moduleForPath("Wisdom Drops/Quotes & Tweets/x.md", DEFAULT_MODULES)?.id).toBe("quotes");
    expect(moduleForPath("Organization/Backups/x.md", DEFAULT_MODULES)?.id).toBe("organization");
    expect(moduleForPath("Organization/SOPs/x.md", DEFAULT_MODULES)?.id).toBe("sops");
    expect(moduleForPath("Organization/Home Inventory/x.md", DEFAULT_MODULES)?.id).toBe("home");
    expect(moduleForPath("Elsewhere/x.md", DEFAULT_MODULES)).toBeUndefined();
  });
});

describe("store", () => {
  it("creates an item as a real note file in the app's folder", async () => {
    const { mem, store } = await fresh();
    const item = await store.createItem("recipes", "Chicken Curry");
    expect(item.path).toBe("Recipes/Chicken Curry.md");
    expect(mem.files.get(item.path)?.text).toContain("title: Chicken Curry");
    expect(store.index.inModule("recipes")).toHaveLength(1);
  });

  it("uses a date prefix where the app asks for one", async () => {
    const { store } = await fresh();
    const item = await store.createItem("medical", "Blood Test", "Blood Tests");
    expect(item.path).toMatch(/^Health\/Medical\/Blood Tests\/\d{4}-\d{2} Blood Test\.md$/);
  });

  it("never overwrites: same title gets a number", async () => {
    const { store } = await fresh();
    await store.createItem("recipes", "Dal");
    const b = await store.createItem("recipes", "Dal");
    expect(b.path).toBe("Recipes/Dal 2.md");
  });

  it("renames and moves the note and its files together", async () => {
    const { mem, store } = await fresh();
    mem.external.set("/Users/me/Downloads/photo.jpg", "img");
    let item = await store.createItem("recipes", "Dal");
    item = await store.addFiles(item, ["/Users/me/Downloads/photo.jpg"]);
    expect(item.files).toEqual(["Dal.jpg"]);
    expect(mem.external.size).toBe(0); // moved, not copied
    item = await store.saveItem({ ...item, title: "Yellow Dal", folder: "Family" }, { rename: true });
    expect(item.path).toBe("Recipes/Family/Yellow Dal.md");
    expect(item.files).toEqual(["Yellow Dal.jpg"]);
    expect(mem.files.has("Recipes/Family/Yellow Dal.jpg")).toBe(true);
    expect(mem.files.has("Recipes/Dal.md")).toBe(false);
  });

  it("links across apps and shows Linked from", async () => {
    const { store } = await fresh();
    const biz = await store.createItem("projects", "My Business");
    const app = await store.createItem("projects", "Job Networking App", "My Business/Software");
    await store.addLink(app, biz, "part of");
    const back = store.index.backlinks(biz.id);
    expect(back.map((b) => [b.item.title, b.kind])).toEqual([["Job Networking App", "part of"]]);
    const goal = await store.createItem("life", "Create a business");
    await store.addLink(goal, biz, "project");
    expect(store.index.backlinks(biz.id)).toHaveLength(2);
  });

  it("gives Finder-made notes an id when something links to them", async () => {
    const { mem, store } = await fresh();
    mem.dropFile("Library/Dune.md", "# Dune");
    await store.rescan();
    const dune = store.index.inModule("library")[0];
    expect(dune.hasId).toBe(false);
    const quote = await store.createItem("quotes", "Fear is the mind-killer");
    await store.addLink(quote, dune, "source");
    const reloaded = store.index.inModule("library")[0];
    expect(reloaded.hasId).toBe(true);
    expect(store.index.backlinks(reloaded.id)).toHaveLength(1);
  });

  it("picks up loose files dropped in through Finder and can file them", async () => {
    const { mem, store } = await fresh();
    mem.dropFile("Health/Medical/Blood Tests/2026-03 Blood Test.pdf", "%PDF");
    await store.rescan();
    expect(store.index.unfiled("medical").map((e) => e.path)).toEqual(["Health/Medical/Blood Tests/2026-03 Blood Test.pdf"]);
    const item = await store.fileLooseFile("medical", "Health/Medical/Blood Tests/2026-03 Blood Test.pdf");
    expect(item.path).toBe("Health/Medical/Blood Tests/2026-03 Blood Test.md");
    expect(item.folder).toBe("Blood Tests");
    expect(store.index.unfiled("medical")).toHaveLength(0);
  });

  it("deletes into a hidden trash folder, not forever", async () => {
    const { mem, store } = await fresh();
    const item = await store.createItem("recipes", "Dal");
    await store.deleteItem(item);
    expect(store.index.inModule("recipes")).toHaveLength(0);
    expect([...mem.files.keys()].some((p) => p.startsWith(".trash/") && p.endsWith("Recipes/Dal.md"))).toBe(true);
  });

  it("saves field changes to .lifeos/modules.json", async () => {
    const { mem, store } = await fresh();
    await store.saveFields("recipes", [{ key: "Spice level", type: "select", options: ["Mild", "Hot"] }]);
    expect(store.module("recipes")?.fields.map((f) => f.key)).toEqual(["Spice level"]);
    expect(mem.files.get(".lifeos/modules.json")?.text).toContain("Spice level");
  });

  it("searches across titles, text, tags and fields", async () => {
    const { store } = await fresh();
    const a = await store.createItem("recipes", "Chicken Curry");
    await store.saveItem({ ...a, tags: ["family"], body: "garam masala" });
    await store.createItem("library", "Dune");
    expect(store.index.search("masala").map((i) => i.title)).toEqual(["Chicken Curry"]);
    expect(store.index.search("family").map((i) => i.title)).toEqual(["Chicken Curry"]);
    expect(store.index.search("dune").map((i) => i.title)).toEqual(["Dune"]);
  });
});

import { renderMarkdown } from "../ui/markdown";
describe("notes preview", () => {
  it("renders the basics and escapes HTML", () => {
    const html = renderMarkdown("## Ingredients\n- toor dal\n- **tamarind**\n\n1. Boil\n2. Add [link](https://x.com)\n\n<script>alert(1)</script>");
    expect(html).toContain("<h2>Ingredients</h2>");
    expect(html).toContain("<ul><li>toor dal</li><li><strong>tamarind</strong></li></ul>");
    expect(html).toContain("<ol><li>Boil</li>");
    expect(html).toContain('<a href="https://x.com"');
    expect(html).not.toContain("<script>");
  });
});

describe("projects", () => {
  it("creates a project folder with Overview, Venture sections, Deck and Documentation", async () => {
    const { mem, store } = await fresh();
    const p = await store.createProject("LifeOS", "My Business/Software");
    expect(p.kind).toBe("project");
    expect(p.path).toBe("Projects/My Business/Software/LifeOS/lifeos.lifeos");
    const parts = store.index.partsOf(p);
    expect(parts.sections.map((s) => s.title)).toEqual([
      "Market Research", "Customer Development", "UI/UX", "Planning", "Marketing", "Operations", "Funding", "Financials", "Deck",
    ]);
    expect(parts.docs?.title).toBe("Documentation");
    expect(mem.files.get("Projects/My Business/Software/LifeOS/lifeos.lifeos")?.text).toContain("Lean canvas");
  });

  it("module pages live inside the project and don't get Venture sections", async () => {
    const { store } = await fresh();
    const p = await store.createProject("LifeOS");
    const journal = await store.addModulePage(p, "Journal", "journal");
    expect(journal.path).toBe("Projects/LifeOS/Modules/Journal.md");
    expect(journal.kind).toBe("module");
    expect(store.index.partsOf(p).modules.map((m) => m.title)).toEqual(["Journal"]);
    expect(store.index.partsOf(p).sections).toHaveLength(9);
    expect(store.index.docsForApp("journal")?.id).toBe(journal.id);
  });

  it("sub-projects nest inside their parent project", async () => {
    const { store } = await fresh();
    const biz = await store.createProject("My Business");
    const app = await store.createProject("Job Networking App", "My Business/Software");
    expect(store.index.parentProject(app)?.id).toBe(biz.id);
    expect(store.index.partsOf(biz).subprojects.map((s) => s.title)).toEqual(["Job Networking App"]);
    // The sub-project's sections belong to it, not to the parent.
    expect(store.index.partsOf(biz).sections).toHaveLength(9);
  });

  it("renaming or moving a project moves its whole folder", async () => {
    const { mem, store } = await fresh();
    const p = await store.createProject("Life OS");
    await store.addModulePage(p, "Recipes", "recipes");
    const moved = await store.moveProject(p, "LifeOS", "My Business/Software");
    expect(moved.path).toBe("Projects/My Business/Software/LifeOS/lifeos.lifeos");
    expect(mem.files.has("Projects/My Business/Software/LifeOS/Modules/Recipes.md")).toBe(true);
    expect([...mem.files.keys()].some((k) => k.startsWith("Projects/Life OS/"))).toBe(false);
    expect(store.index.partsOf(moved).modules).toHaveLength(1);
  });

  it("restores missing sections without touching existing ones", async () => {
    const { mem, store } = await fresh();
    const p = await store.createProject("Verzuz", "Personal");
    mem.files.delete("Projects/Personal/Verzuz/06 Marketing.md");
    await mem.write("Projects/Personal/Verzuz/02 Market Research.md", "my own notes");
    await store.rescan();
    await store.addMissingSections(p);
    expect(mem.files.has("Projects/Personal/Verzuz/06 Marketing.md")).toBe(true);
    expect(mem.files.get("Projects/Personal/Verzuz/02 Market Research.md")?.text).toBe("my own notes");
  });

  it("deletes a whole project into the trash", async () => {
    const { mem, store } = await fresh();
    const p = await store.createProject("Old idea");
    await store.deleteProject(p);
    expect(store.index.projects()).toHaveLength(0);
    expect([...mem.files.keys()].every((k) => k.startsWith(".trash/") || k.startsWith(".lifeos/"))).toBe(true);
  });
});

import { addLogEntry } from "../ui/ItemView";
describe("build log", () => {
  it("adds today's entry above the newest one, once", () => {
    const body = "Intro.\n\n## 2026-11-09\n\n- Started.\n";
    const once = addLogEntry(body, "2026-11-10", "##");
    expect(once.indexOf("## 2026-11-10")).toBeLessThan(once.indexOf("## 2026-11-09"));
    expect(addLogEntry(once, "2026-11-10", "##")).toBe(once);
  });
  it("goes under 'Build log' on a module page with no entries", () => {
    const out = addLogEntry("## What it does\n\n## Build log\n", "2026-11-10", "###");
    expect(out).toMatch(/## Build log\n\n### 2026-11-10/);
  });
  it("section and Documentation pages keep their file names when saved", async () => {
    const { store } = await fresh();
    const p = await store.createProject("LifeOS");
    const market = store.index.partsOf(p).sections.find((s) => s.title === "Market Research")!;
    const saved = await store.saveItem({ ...market, body: "notes" }, { rename: false });
    expect(saved.path).toBe(market.path);
  });
});

describe("older project notes", () => {
  it("turn into a real project folder, keeping their text", async () => {
    const { store } = await fresh();
    const old = await store.createItem("projects", "Verzuz", "Personal");
    await store.saveItem({ ...old, body: "My redesign notes" });
    expect(store.index.looseProjectNotes().map((n) => n.title)).toEqual(["Verzuz"]);
    const p = await store.convertToProject(store.index.looseProjectNotes()[0]);
    expect(p.path).toBe("Projects/Personal/Verzuz/verzuz.lifeos");
    expect(p.body).toContain("My redesign notes");
    expect(store.index.looseProjectNotes()).toHaveLength(0);
    expect(store.index.partsOf(p).sections).toHaveLength(9);
  });
});

describe("turning notes into projects in place", () => {
  it("a note in a folder of its own name becomes a project there, and notes inside become sub-projects", async () => {
    const { mem, store } = await fresh();
    mem.dropFile("Projects/My Business/My Business.md", "---\ntitle: My Business\n---\nDivisions");
    mem.dropFile("Projects/My Business/Software/LifeOS.md", "---\ntitle: LifeOS\n---\nOne folder");
    await store.rescan();
    const biz = await store.convertToProject(store.index.byPath.get("Projects/My Business/My Business.md")!);
    expect(biz.path).toBe("Projects/My Business/mybusiness.lifeos");
    expect(mem.files.has("Projects/My Business/My Business.md")).toBe(false);
    expect(biz.body).toContain("Divisions");
    const life = await store.convertToProject(store.index.byPath.get("Projects/My Business/Software/LifeOS.md")!);
    expect(life.path).toBe("Projects/My Business/Software/LifeOS/lifeos.lifeos");
    expect(store.index.parentProject(life)?.id).toBe(biz.id);
    expect(store.index.partsOf(biz).subprojects.map((p) => p.title)).toEqual(["LifeOS"]);
  });
});

describe("folders", () => {
  it("makes every app's folder when LifeOS opens", async () => {
    const { mem } = await fresh();
    for (const f of ["Saved Content", "To-Do & Routines", "Journal", "Projects", "Health/Medical", "Wisdom Drops/Quotes & Tweets", "Organization/SOPs", "Organization/Home Inventory", "Organization/Backups", "Organization/AI Settings", "Organization/Tech Stack", "Organization/Bookmarks"]) {
      expect(mem.dirs.has(f)).toBe(true);
    }
  });
});

describe("choosing a project's parts and its Board", () => {
  it("a simple project is just its folder and Board; parts can be added later", async () => {
    const { mem, store } = await fresh();
    const p = await store.createProject("Handwriting Font", "Personal", {}, []);
    expect([...mem.files.keys()].filter((k) => k.startsWith("Projects/Personal/Handwriting Font/"))).toEqual([
      "Projects/Personal/Handwriting Font/handwritingfont.lifeos",
    ]);
    expect(p.body.trim()).toBe("");
    await store.addPart(p, "02 Market Research");
    await store.addPart(store.index.items.get(p.id)!, "overview");
    const parts = store.index.partsOf(store.index.items.get(p.id)!);
    expect(parts.sections.map((s) => s.title)).toEqual(["Market Research"]);
    expect(parts.docs).toBeUndefined();
    expect(store.index.items.get(p.id)!.body).toContain("## Lean canvas");
  });

  it("only makes the parts that were ticked", async () => {
    const { store } = await fresh();
    const p = await store.createProject("App", "", {}, ["overview", "10 Deck", "docs"]);
    const parts = store.index.partsOf(p);
    expect(parts.sections.map((s) => s.title)).toEqual(["Deck"]);
    expect(parts.docs).toBeTruthy();
    expect(p.body).toContain("## Lean canvas");
  });

  it("saves Board cards in the project .lifeos file and reads them back", async () => {
    const { mem, store } = await fresh();
    const p = await store.createProject("Font", "", {}, []);
    await store.saveBoard(p, [
      { id: "t1", type: "text", text: "Line one\nLine two: with a colon", x: 10, y: 20, w: 300 },
      { id: "p1", type: "page", page: "overview", x: 5, y: 6 },
    ]);
    expect(mem.files.get(p.path)!.text).toContain("board:");
    expect(p.path).toBe("Projects/Font/font.lifeos");
    const again = store.index.items.get(p.id)!;
    expect(again.board).toEqual([
      { id: "t1", type: "text", text: "Line one\nLine two: with a colon", x: 10, y: 20, w: 300 },
      { id: "p1", type: "page", page: "overview", x: 5, y: 6 },
    ]);
    expect(again.fields["board"]).toBeUndefined();
    expect(store.index.search("colon").map((i) => i.id)).toContain(p.id);
  });

  it("makes a named Markdown page on the Board", async () => {
    const { mem, store } = await fresh();
    const p = await store.createProject("Font", "", {}, []);
    const dir = p.path.slice(0, p.path.lastIndexOf("/"));
    const a = await store.createBoardMarkdown(p, "Ideas", { x: 10, y: 10 });
    expect(mem.files.has(`${dir}/Ideas.md`)).toBe(true);
    const b = await store.createBoardMarkdown(a, "Ideas.md", { x: 10, y: 10 });
    expect(mem.files.has(`${dir}/Ideas 2.md`)).toBe(true);
    expect(b.board?.map((c) => c.file)).toEqual(["Ideas.md", "Ideas 2.md"]);
  });

  it("moves dropped files into the project folder with their own names, and trashes them when removed", async () => {
    const { mem, store } = await fresh();
    mem.external.set("/Users/you/Desktop/sketch.png", "PNG");
    mem.external.set("/Users/you/Desktop/other/sketch.png", "PNG2");
    const p = await store.createProject("Font", "", {}, []);
    const saved = await store.addBoardFiles(p, ["/Users/you/Desktop/sketch.png", "/Users/you/Desktop/other/sketch.png"], { x: 100, y: 50 });
    expect(saved.files).toEqual(["sketch.png", "sketch 2.png"]);
    expect(mem.files.has("Projects/Font/sketch.png")).toBe(true);
    expect(mem.external.size).toBe(0);
    expect(saved.board?.map((c) => [c.type, c.file, c.x, c.y])).toEqual([
      ["file", "sketch.png", 100, 50],
      ["file", "sketch 2.png", 380, 50],
    ]);
    expect(store.index.unfiled("projects")).toEqual([]);
    const after = await store.removeBoardCard(saved, saved.board![0]);
    expect(after.files).toEqual(["sketch 2.png"]);
    expect(mem.files.has("Projects/Font/sketch.png")).toBe(false);
    expect([...mem.files.keys()].some((k) => k.startsWith(".trash/") && k.endsWith("Projects/Font/sketch.png"))).toBe(true);
  });
});

describe("Board: sections, link cards and arrows", () => {
  it("are saved in the project file and read back; removing a card takes its arrows with it", async () => {
    const { store } = await fresh();
    const p = await store.createProject("Font", "", {}, []);
    const board = [
      { id: "s1", type: "section" as const, text: "Concept", x: 10, y: 20, w: 400, h: 260 },
      { id: "t1", type: "text" as const, text: "Idea", x: 30, y: 60, w: 240 },
      { id: "e1", type: "embed" as const, embed: "artifact" as const, url: "https://claude.ai/artifact/abc", text: "Design", x: 500, y: 60, w: 260 },
      { id: "a1", type: "arrow" as const, from: "t1", to: "e1", x: 0, y: 0 },
    ];
    await store.saveBoard(p, board);
    await store.rescan();
    const back = store.index.items.get(p.id)!.board!;
    expect(back.map((c) => c.type)).toEqual(["section", "text", "embed", "arrow"]);
    expect(back[0]).toMatchObject({ text: "Concept", w: 400, h: 260 });
    expect(back[2]).toMatchObject({ embed: "artifact", url: "https://claude.ai/artifact/abc", text: "Design" });
    expect(back[3]).toMatchObject({ from: "t1", to: "e1" });
    const after = await store.removeBoardCard(store.index.items.get(p.id)!, back[1]);
    expect(after.board?.map((c) => c.id)).toEqual(["s1", "e1"]);
  });
});

describe("older projects", () => {
  it("move to one .lifeos file, taking the Board from projectboard.lifeos", async () => {
    const { mem, store } = await fresh();
    mem.dropFile("Projects/Personal/Old/Old.md", "---\nid: abc\nkind: project\ntitle: Old\n---\n");
    mem.dropFile("Projects/Personal/Old/projectboard.lifeos", JSON.stringify({ board: [{ id: "t", type: "text", text: "hi", x: 1, y: 2 }] }));
    await store.rescan();
    const old = store.index.items.get("abc")!;
    expect(old.board?.[0].text).toBe("hi");
    await store.openRoot(""); // opening LifeOS upgrades it right away
    expect(mem.files.has("Projects/Personal/Old/old.lifeos")).toBe(true);
    expect(mem.files.has("Projects/Personal/Old/Old.md")).toBe(false);
    expect(mem.files.has("Projects/Personal/Old/projectboard.lifeos")).toBe(false);
    expect(store.index.items.get("abc")!.board?.[0].text).toBe("hi");
  });
});

describe("journal days", () => {
  it("makes one folder per day, keeps added files under their own names", async () => {
    const { mem, store } = await fresh();
    const day = await store.openJournalDay("2026-11-11");
    expect(day.path).toBe("Journal/2026-11-11/2026-11-11.md");
    expect((await store.openJournalDay("2026-11-11")).id).toBe(day.id);
    mem.external.set("/Users/you/Desktop/walk.jpg", "JPG");
    mem.external.set("/Users/you/Desktop/memo.m4a", "AUDIO");
    await store.addJournalFiles(day, ["/Users/you/Desktop/walk.jpg", "/Users/you/Desktop/memo.m4a"]);
    expect(mem.files.has("Journal/2026-11-11/walk.jpg")).toBe(true);
    expect(mem.files.has("Journal/2026-11-11/memo.m4a")).toBe(true);
    await store.removeJournalFile(day, "walk.jpg");
    expect(mem.files.has("Journal/2026-11-11/walk.jpg")).toBe(false);
    await store.deleteJournalDay(day);
    expect([...mem.files.keys()].some((p) => p.startsWith("Journal/2026-11-11/"))).toBe(false);
  });

  it("a line like ![](photo.jpg) shows that file inside the text", async () => {
    const { renderMarkdown } = await import("../ui/markdown");
    const html = renderMarkdown("Morning.\n\n![](my%20photo.jpg)\n\n![](clip.mov)\n\n![](voice.m4a)\n\nEvening.", (n) => `file://${n}`);
    expect(html).toContain('<img class="md-img" src="file://my photo.jpg"');
    expect(html).toContain('<video class="md-video" controls');
    expect(html).toContain('<audio controls');
    expect(html.indexOf("Morning")).toBeLessThan(html.indexOf("<img"));
    expect(html.indexOf("<audio")).toBeLessThan(html.indexOf("Evening"));
  });
});

describe("pasted journal pictures", () => {
  it("saves a pasted picture as its own file in the day's folder", async () => {
    const { mem, store } = await fresh();
    const day = await store.openJournalDay("2026-11-11");
    const name = await store.addJournalPicture(day, new Uint8Array([137, 80, 78, 71]), ".png");
    expect(name).toMatch(/^pasted \d{4}-\d{2}-\d{2} \d{6}\.png$/);
    expect(mem.files.has(`Journal/2026-11-11/${name}`)).toBe(true);
    const again = await store.addJournalPicture(day, new Uint8Array([1]), ".png");
    expect(again).not.toBe(name); // never overwrites
  });
});

const NOTE_B64 = "UEsDBBQAAAAAAEGlc12+d+ImeQEAAHkBAAAZAAAAT2N0IDQsIDIwMjYvU2Vzc2lvbi5wbGlzdGJwbGlzdDAw1AECAwQFBhkcWSRhcmNoaXZlclgkb2JqZWN0c1QkdG9wWCR2ZXJzaW9uXxAPTlNLZXllZEFyY2hpdmVypgcICw4RFlUkbnVsbNEJClhyaWNoVGV4dIAC0QwNXxAZTkJBdHRyaWJ1dGVkQmFja2luZ1N0cmluZ4AD0Q8QXxAiTkJBdHRyaWJ1dGVkQmFja2luZ1N0cmluZ0NvZGluZ0tleYAE0hITFBVZc3RyaW5nS2V5XHN1YlJhbmdlc0tleYAFgADRFxhYTlMuYnl0ZXNPEDdEZWFyIGRpYXJ5LgpUb2RheSB3YXMgZ29vZCAocmVhbGx5KS4KClNlY29uZCBwYXJhZ3JhcGgu0RobVHJvb3SAARIAAYagAAgAEQAbACQAKQAyAEQASwBRAFQAXQBfAGIAfgCAAIMAqACqAK8AuQDGAMgAygDNANYBEAETARgBGgAAAAAAAAIBAAAAAAAAAB0AAAAAAAAAAAAAAAAAAAEfUEsDBBQAAAAAAEGlc10+verH2wAAANsAAAAaAAAAT2N0IDQsIDIwMjYvbWV0YWRhdGEucGxpc3RicGxpc3QwMNQBAgMEBQYRFFkkYXJjaGl2ZXJYJG9iamVjdHNUJHRvcFgkdmVyc2lvbl8QD05TS2V5ZWRBcmNoaXZlcqQHCA0OVSRudWxs0gkKCwxfEBNub3RlQ3JlYXRpb25EYXRlS2V5WG5vdGVOYW1lgAOAAltPY3QgNCwgMjAyNtEPEFdOUy50aW1lI0HIOmVlwAAA0RITVHJvb3SAARIAAYagCBEbJCkyRElPVGpzdXeDho6Xmp+hAAAAAAAAAQEAAAAAAAAAFQAAAAAAAAAAAAAAAAAAAKZQSwMEFAAAAAAAQaVzXUcYGtsHAAAABwAAAB4AAABPY3QgNCwgMjAyNi9JbWFnZXMvcGljIG9uZS5wbmdQTkdEQVRBUEsDBBQAAAAAAEGlc10l9CnvBQAAAAUAAAAeAAAAT2N0IDQsIDIwMjYvUmVjb3JkaW5ncy9yZWMubTRhQVVESU9QSwMEFAAAAAAAQaVzXYMW3IwBAAAAAQAAACQAAABPY3QgNCwgMjAyNi9SZWNvcmRpbmdzL2xpYnJhcnkucGxpc3R4UEsBAhQDFAAAAAAAQaVzXb534iZ5AQAAeQEAABkAAAAAAAAAAAAAAIABAAAAAE9jdCA0LCAyMDI2L1Nlc3Npb24ucGxpc3RQSwECFAMUAAAAAABBpXNdPr3qx9sAAADbAAAAGgAAAAAAAAAAAAAAgAGwAQAAT2N0IDQsIDIwMjYvbWV0YWRhdGEucGxpc3RQSwECFAMUAAAAAABBpXNdRxga2wcAAAAHAAAAHgAAAAAAAAAAAAAAgAHDAgAAT2N0IDQsIDIwMjYvSW1hZ2VzL3BpYyBvbmUucG5nUEsBAhQDFAAAAAAAQaVzXSX0Ke8FAAAABQAAAB4AAAAAAAAAAAAAAIABBgMAAE9jdCA0LCAyMDI2L1JlY29yZGluZ3MvcmVjLm00YVBLAQIUAxQAAAAAAEGlc12DFtyMAQAAAAEAAAAkAAAAAAAAAAAAAACAAUcDAABPY3QgNCwgMjAyNi9SZWNvcmRpbmdzL2xpYnJhcnkucGxpc3RQSwUGAAAAAAUABQB5AQAAigMAAAAA";
const noteBinary = () => atob(NOTE_B64);

describe("importing Notability notes", () => {
  it("reads the text, date, pictures and recordings out of a .note file", async () => {
    const { parseNote } = await import("./notability");
    const bytes = Uint8Array.from(noteBinary(), (c) => c.charCodeAt(0));
    const note = await parseNote(bytes);
    expect(note.title).toBe("Oct 4, 2026");
    expect(note.created).toMatch(/^2026-10-0[56]$/);
    expect(note.text).toBe("Dear diary.\nToday was good (really).\n\nSecond paragraph.");
    expect(note.files.map((f) => [f.kind, f.name])).toEqual([["image", "pic one.png"], ["audio", "rec.m4a"]]);
  });

  it("makes a day from the title's date, keeps pictures and recordings as files, trashes the .note", async () => {
    const { mem, store } = await fresh();
    mem.external.set("/Users/you/Desktop/Oct 4, 2026.note", noteBinary());
    mem.external.set("/Users/you/Desktop/Readme.txt", "hi");
    const r = await store.importNoteFiles(["/Users/you/Desktop/Oct 4, 2026.note", "/Users/you/Desktop/Readme.txt"]);
    expect(r.imported).toBe(1);
    expect(r.problems).toEqual(["Readme.txt: not a Notability .note file, left where it is"]);
    const day = store.index.byPath.get("Journal/2026-10-04/2026-10-04.md")!;
    expect(day.body).toContain("Dear diary.\nToday was good (really).");
    expect(day.body).toContain("![](pic%20one.png)");
    expect(day.body).toContain("![](rec.m4a)");
    expect(mem.files.has("Journal/2026-10-04/pic one.png")).toBe(true);
    expect(mem.files.has("Journal/2026-10-04/rec.m4a")).toBe(true);
    expect([...mem.files.keys()].some((p) => p.startsWith(".trash/") && p.endsWith("Oct 4, 2026.note"))).toBe(true);
    expect(mem.files.has("Journal/.import/Oct 4, 2026.note")).toBe(false);
    // importing the same note again doesn't repeat it
    mem.external.set("/Users/you/Desktop/Oct 4, 2026.note", noteBinary());
    const again = await store.importNoteFiles(["/Users/you/Desktop/Oct 4, 2026.note"]);
    expect(again.imported).toBe(0);
    expect(again.problems[0]).toContain("already in the Journal");
  });

  it("takes the date only from the note's title, never the file name or creation date", async () => {
    const { mem, store } = await fresh();
    // same note, but the file is named with a different date and the title has to decide
    mem.external.set("/Users/you/Desktop/2020-01-01 export.note", noteBinary());
    await store.importNoteFiles(["/Users/you/Desktop/2020-01-01 export.note"]);
    expect(store.index.byPath.has("Journal/2026-10-04/2026-10-04.md")).toBe(true);
    expect(store.index.byPath.has("Journal/2020-01-01/2020-01-01.md")).toBe(false);
    expect(store.index.byPath.has("Journal/2026-10-06/2026-10-06.md")).toBe(false);
  });

  it("a note whose title has no date is added under its title; different notes with one title don't merge", async () => {
    const { mem, store } = await fresh();
    mem.external.set("/Users/you/Desktop/a.note", atob("UEsDBBQAAAAAANSlc101BcTxJQEAACUBAAAYAAAARGVhciBkaWFyeS9TZXNzaW9uLnBsaXN0YnBsaXN0MDDUAQIDBAUGFxpZJGFyY2hpdmVyWCRvYmplY3RzVCR0b3BYJHZlcnNpb25fEA9OU0tleWVkQXJjaGl2ZXKmBwgLDhEUVSRudWxs0QkKWHJpY2hUZXh0gALRDA1fEBlOQkF0dHJpYnV0ZWRCYWNraW5nU3RyaW5ngAPRDxBfECJOQkF0dHJpYnV0ZWRCYWNraW5nU3RyaW5nQ29kaW5nS2V5gATREhNZc3RyaW5nS2V5gAXRFRZYTlMuYnl0ZXNPEBNXb3JkcyB3aXRoIG5vIGRhdGUu0RgZVHJvb3SAARIAAYagCBEbJCkyREtRVF1fYn6Ag6iqrbe5vMXb3uPlAAAAAAAAAQEAAAAAAAAAGwAAAAAAAAAAAAAAAAAAAOpQSwMEFAAAAAAA1KVzXc3AW97aAAAA2gAAABkAAABEZWFyIGRpYXJ5L21ldGFkYXRhLnBsaXN0YnBsaXN0MDDUAQIDBAUGERRZJGFyY2hpdmVyWCRvYmplY3RzVCR0b3BYJHZlcnNpb25fEA9OU0tleWVkQXJjaGl2ZXKkBwgNDlUkbnVsbNIJCgsMXxATbm90ZUNyZWF0aW9uRGF0ZUtleVhub3RlTmFtZYADgAJaRGVhciBkaWFyedEPEFdOUy50aW1lI0HIOmVlwAAA0RITVHJvb3SAARIAAYagCBEbJCkyRElPVGpzdXeChY2WmZ6gAAAAAAAAAQEAAAAAAAAAFQAAAAAAAAAAAAAAAAAAAKVQSwECFAMUAAAAAADUpXNdNQXE8SUBAAAlAQAAGAAAAAAAAAAAAAAAgAEAAAAARGVhciBkaWFyeS9TZXNzaW9uLnBsaXN0UEsBAhQDFAAAAAAA1KVzXc3AW97aAAAA2gAAABkAAAAAAAAAAAAAAIABWwEAAERlYXIgZGlhcnkvbWV0YWRhdGEucGxpc3RQSwUGAAAAAAIAAgCNAAAAbAIAAAAA"));
    const r = await store.importNoteFiles(["/Users/you/Desktop/a.note"]);
    expect(r).toEqual({ imported: 1, problems: [] });
    const entry = store.index.byPath.get("Journal/Dear diary/Dear diary.md")!;
    expect(entry.body).toContain("Words with no date.");
    expect(entry.title).toBe("Dear diary");
    mem.external.set("/Users/you/Desktop/b.note", atob("UEsDBBQAAAAAANSlc128sQpFLQEAAC0BAAAYAAAARGVhciBkaWFyeS9TZXNzaW9uLnBsaXN0YnBsaXN0MDDUAQIDBAUGFxpZJGFyY2hpdmVyWCRvYmplY3RzVCR0b3BYJHZlcnNpb25fEA9OU0tleWVkQXJjaGl2ZXKmBwgLDhEUVSRudWxs0QkKWHJpY2hUZXh0gALRDA1fEBlOQkF0dHJpYnV0ZWRCYWNraW5nU3RyaW5ngAPRDxBfECJOQkF0dHJpYnV0ZWRCYWNraW5nU3RyaW5nQ29kaW5nS2V5gATREhNZc3RyaW5nS2V5gAXRFRZYTlMuYnl0ZXNPEBtBIGRpZmZlcmVudCBlbnRyeSBlbnRpcmVseS7RGBlUcm9vdIABEgABhqAIERskKTJES1FUXV9ifoCDqKqtt7m8xePm6+0AAAAAAAABAQAAAAAAAAAbAAAAAAAAAAAAAAAAAAAA8lBLAwQUAAAAAADUpXNdzcBb3toAAADaAAAAGQAAAERlYXIgZGlhcnkvbWV0YWRhdGEucGxpc3RicGxpc3QwMNQBAgMEBQYRFFkkYXJjaGl2ZXJYJG9iamVjdHNUJHRvcFgkdmVyc2lvbl8QD05TS2V5ZWRBcmNoaXZlcqQHCA0OVSRudWxs0gkKCwxfEBNub3RlQ3JlYXRpb25EYXRlS2V5WG5vdGVOYW1lgAOAAlpEZWFyIGRpYXJ50Q8QV05TLnRpbWUjQcg6ZWXAAADREhNUcm9vdIABEgABhqAIERskKTJESU9UanN1d4KFjZaZnqAAAAAAAAABAQAAAAAAAAAVAAAAAAAAAAAAAAAAAAAApVBLAQIUAxQAAAAAANSlc128sQpFLQEAAC0BAAAYAAAAAAAAAAAAAACAAQAAAABEZWFyIGRpYXJ5L1Nlc3Npb24ucGxpc3RQSwECFAMUAAAAAADUpXNdzcBb3toAAADaAAAAGQAAAAAAAAAAAAAAgAFjAQAARGVhciBkaWFyeS9tZXRhZGF0YS5wbGlzdFBLBQYAAAAAAgACAI0AAAB0AgAAAAA="));
    const second = await store.importNoteFiles(["/Users/you/Desktop/b.note"]);
    expect(second.imported).toBe(1);
    expect(store.index.byPath.get("Journal/Dear diary 2/Dear diary 2.md")!.body).toContain("A different entry entirely.");
    mem.external.set("/Users/you/Desktop/c.note", atob("UEsDBBQAAAAAANSlc101BcTxJQEAACUBAAAYAAAARGVhciBkaWFyeS9TZXNzaW9uLnBsaXN0YnBsaXN0MDDUAQIDBAUGFxpZJGFyY2hpdmVyWCRvYmplY3RzVCR0b3BYJHZlcnNpb25fEA9OU0tleWVkQXJjaGl2ZXKmBwgLDhEUVSRudWxs0QkKWHJpY2hUZXh0gALRDA1fEBlOQkF0dHJpYnV0ZWRCYWNraW5nU3RyaW5ngAPRDxBfECJOQkF0dHJpYnV0ZWRCYWNraW5nU3RyaW5nQ29kaW5nS2V5gATREhNZc3RyaW5nS2V5gAXRFRZYTlMuYnl0ZXNPEBNXb3JkcyB3aXRoIG5vIGRhdGUu0RgZVHJvb3SAARIAAYagCBEbJCkyREtRVF1fYn6Ag6iqrbe5vMXb3uPlAAAAAAAAAQEAAAAAAAAAGwAAAAAAAAAAAAAAAAAAAOpQSwMEFAAAAAAA1KVzXc3AW97aAAAA2gAAABkAAABEZWFyIGRpYXJ5L21ldGFkYXRhLnBsaXN0YnBsaXN0MDDUAQIDBAUGERRZJGFyY2hpdmVyWCRvYmplY3RzVCR0b3BYJHZlcnNpb25fEA9OU0tleWVkQXJjaGl2ZXKkBwgNDlUkbnVsbNIJCgsMXxATbm90ZUNyZWF0aW9uRGF0ZUtleVhub3RlTmFtZYADgAJaRGVhciBkaWFyedEPEFdOUy50aW1lI0HIOmVlwAAA0RITVHJvb3SAARIAAYagCBEbJCkyRElPVGpzdXeChY2WmZ6gAAAAAAAAAQEAAAAAAAAAFQAAAAAAAAAAAAAAAAAAAKVQSwECFAMUAAAAAADUpXNdNQXE8SUBAAAlAQAAGAAAAAAAAAAAAAAAgAEAAAAARGVhciBkaWFyeS9TZXNzaW9uLnBsaXN0UEsBAhQDFAAAAAAA1KVzXc3AW97aAAAA2gAAABkAAAAAAAAAAAAAAIABWwEAAERlYXIgZGlhcnkvbWV0YWRhdGEucGxpc3RQSwUGAAAAAAIAAgCNAAAAbAIAAAAA"));
    const again = await store.importNoteFiles(["/Users/you/Desktop/c.note"]);
    expect(again.imported).toBe(0);
    expect(again.problems[0]).toContain("already in the Journal");
    expect(store.index.byPath.has("Journal/Dear diary 3/Dear diary 3.md")).toBe(false);
  });

  it("reads dates from file names", async () => {
    const { dateFromName } = await import("./journal");
    expect(dateFromName("2025-03-14 Journal")).toBe("2025-03-14");
    expect(dateFromName("March 14, 2025")).toBe("2025-03-14");
    expect(dateFromName("Oct 4, 2026")).toBe("2026-10-04");
    expect(dateFromName("14 March 2025 - notes")).toBe("2025-03-14");
    expect(dateFromName("3/14/2025")).toBe("2025-03-14");
    expect(dateFromName("Dear diary")).toBe("");
    expect(dateFromName("2025-13-40")).toBe("");
  });
});

describe("courses, programs and lessons", () => {
  it("a program is only a folder, its courses are folders inside it, and their lessons are folders inside those", async () => {
    const { mem, store } = await fresh();
    const base = "Courses/UX Certificate";
    const intro = await store.createProgram("UX Certificate", "Intro to UX Design");
    expect(intro.path).toBe(`${base}/Intro to UX Design/Intro to UX Design.md`);
    expect(mem.files.has(`${base}/UX Certificate.md`)).toBe(false);
    const fe = await store.addCourseToProgram(base, "Front-End Development", "Someone");
    const l1 = await store.addCourseLesson(fe, "1 - Getting Started with HTML & CSS");
    const l2 = await store.addCourseLesson(store.index.items.get(fe.id)!, "2 - JavaScript & Your Portfolio Site");
    expect(l1.path).toBe(`${base}/Front-End Development/1 - Getting Started with HTML & CSS/1 - Getting Started with HTML & CSS.md`);
    expect(store.index.programs()).toEqual([base]);
    expect(store.index.programCourses(base).map((c) => c.title)).toEqual(["Intro to UX Design", "Front-End Development"]);
    expect(store.index.courseParts(store.index.items.get(fe.id)!).map((l) => l.title)).toEqual([l1.title, l2.title]);
    expect(store.index.courseParent(l1)?.id).toBe(fe.id);
    expect(store.index.programOf(store.index.items.get(fe.id)!)).toBe(base);
    expect(store.index.isTopLevelCourse(l1)).toBe(false);
    // a PDF added to a lesson sits in that lesson's folder
    mem.external.set("/Users/you/Desktop/1.1 - Start.pdf", "PDF");
    expect(await store.addCourseFiles(l1, ["/Users/you/Desktop/1.1 - Start.pdf"])).toBe(1);
    expect(mem.files.has(`${base}/Front-End Development/1 - Getting Started with HTML & CSS/1.1 - Start.pdf`)).toBe(true);
  });

  it("everything already in Courses is marked Completed once; later courses keep their own status", async () => {
    const mem = new MemoryStorage(false);
    mem.dropFile("Courses/Old Course.md", '---\nid: o1\ntitle: "Old Course"\nStatus: Want\n---\n');
    mem.dropFile("Courses/Prog/Prog Course/Prog Course.md", '---\nid: o2\ntitle: "Prog Course"\n---\n');
    mem.dropFile("Courses/Done Course.md", '---\nid: o3\ntitle: "Done Course"\nStatus: Done\n---\n');
    const store = new LifeStore(mem);
    await store.init();
    for (const id of ["o1", "o2", "o3"]) expect(store.index.items.get(id)!.fields["Status"]).toBe("Completed");
    expect(mem.files.has(".lifeos/courses-status-completed")).toBe(true);
    const fresh1 = await store.createItem("courses", "New One", "", {});
    await store.openRoot("");
    expect(store.index.items.get(fresh1.id)!.fields["Status"]).toBeUndefined();
  });

  it("a new program, adding a course to it, and renaming it", async () => {
    const { mem, store } = await fresh();
    const first = await store.createProgram("Spanish Program", "Spanish 101", "Ms. Lopez");
    expect(first.path).toBe("Courses/Spanish Program/Spanish 101/Spanish 101.md");
    expect(mem.files.has("Courses/Spanish Program/Spanish Program.md")).toBe(false);
    const second = await store.addCourseToProgram("Courses/Spanish Program", "Spanish 102");
    expect(second.fields["Part"]).toBe(2);
    const dir = await store.renameProgram("Courses/Spanish Program", "Spanish");
    expect(dir).toBe("Courses/Spanish");
    expect(mem.files.has("Courses/Spanish/Spanish 101/Spanish 101.md")).toBe(true);
    expect(store.index.programCourses(dir).map((c) => c.title)).toEqual(["Spanish 101", "Spanish 102"]);
  });

  it("adding a lesson to a course makes it a folder; renaming the course renames its folder with everything inside", async () => {
    const { mem, store } = await fresh();
    const c = await store.createItem("courses", "Spanish", "", {});
    const lesson = await store.addCourseLesson(c, "Lesson 1");
    expect(lesson.path).toBe("Courses/Spanish/Lesson 1/Lesson 1.md");
    expect(lesson.kind).toBe("lesson");
    const folderItem = store.index.items.get(c.id)!;
    await store.saveItem({ ...folderItem, title: "Spanish Basics" }, { rename: true });
    expect(mem.files.has("Courses/Spanish Basics/Spanish Basics.md")).toBe(true);
    expect(mem.files.has("Courses/Spanish Basics/Lesson 1/Lesson 1.md")).toBe(true);
    expect(mem.files.has("Courses/Spanish/Spanish.md")).toBe(false);
    expect(store.index.courseParts(store.index.items.get(c.id)!).map((l) => l.title)).toEqual(["Lesson 1"]);
    expect(store.index.programs()).toEqual([]);
  });
});

describe("files on a course page", () => {
  it("several files of any kind go in at once, under their own names, into the course's own folder", async () => {
    const { mem, store } = await fresh();
    const course = await store.createItem("courses", "Spanish", "", {});
    for (const f of ["slides.pdf", "notes.md", "board.png", "Lesson 1.note"]) mem.external.set(`/Users/you/Desktop/${f}`, "x");
    const n = await store.addCourseFiles(course, ["slides.pdf", "notes.md", "board.png", "Lesson 1.note"].map((f) => `/Users/you/Desktop/${f}`));
    expect(n).toBe(4);
    const c = store.index.items.get(course.id)!;
    expect(c.path).toBe("Courses/Spanish/Spanish.md");
    expect(c.files).toEqual(["slides.pdf", "notes.md", "board.png", "Lesson 1.note"]);
    for (const f of c.files) expect(mem.files.has(`Courses/Spanish/${f}`)).toBe(true);
    // a second file with the same name is kept, with " 2", never overwritten
    mem.external.set("/Users/you/Downloads/slides.pdf", "y");
    await store.addCourseFiles(c, ["/Users/you/Downloads/slides.pdf"]);
    expect(store.index.items.get(course.id)!.files).toContain("slides 2.pdf");
    expect(mem.files.get("Courses/Spanish/slides.pdf")?.text).toBe("x");
  });

  it("shows 'Course 1 of 3' and 'Lesson 2 of 2', and lists the files in a folder, not ones moved away", async () => {
    const { mem, store } = await fresh();
    const base = "Courses/UX Certificate";
    await store.createProgram("UX Certificate", "Intro to UX Design");
    await store.addCourseToProgram(base, "UX Immersion");
    const fe = await store.addCourseToProgram(base, "Front-End Development");
    const l1 = await store.addCourseLesson(fe, "1 - Getting Started with HTML & CSS");
    const l2 = await store.addCourseLesson(store.index.items.get(fe.id)!, "2 - JavaScript & Your Portfolio Site");
    expect(store.index.partLabel(store.index.items.get(fe.id)!)).toBe("Course 3 of 3");
    expect(store.index.partLabel(store.index.programCourses(base)[0])).toBe("Course 1 of 3");
    expect(store.index.partLabel(l1)).toBe("Lesson 1 of 2");
    expect(store.index.partLabel(l2)).toBe("Lesson 2 of 2");
    // PDFs the Front-End page once listed were moved into the lesson folders in Finder
    const feDir = `${base}/Front-End Development`;
    const feItem = store.index.items.get(fe.id)!;
    await store.saveItem({ ...feItem, files: ["1.1 - Start.pdf", "2.1 - JS.pdf"] }, {});
    mem.dropFile(`${feDir}/${l1.title}/1.1 - Start.pdf`, "PDF");
    mem.dropFile(`${feDir}/${l2.title}/2.1 - JS.pdf`, "PDF");
    mem.dropFile(`${feDir}/${l2.title}/2.2 - More.pdf`, "PDF");
    await store.rescan();
    const page = store.index.items.get(fe.id)!;
    expect(store.index.courseFiles(page)).toEqual({ attached: [], inFolder: [] });
    expect(store.index.courseFiles(store.index.items.get(l1.id)!).inFolder).toEqual(["1.1 - Start.pdf"]);
    expect(store.index.courseFiles(store.index.items.get(l2.id)!).inFolder).toEqual(["2.1 - JS.pdf", "2.2 - More.pdf"]);
    expect(store.index.courseParent(store.index.items.get(l1.id)!)?.id).toBe(fe.id);
  });

  it("a lesson holds classes (Class 1 of 2…), and a class is a folder of its own", async () => {
    const { mem, store } = await fresh();
    const base = "Courses/UX Certificate";
    await store.createProgram("UX Certificate", "Intro to UX Design");
    const course = await store.addCourseToProgram(base, "UX Immersion");
    const lesson = await store.addCourseLesson(course, "Lesson 1");
    const c1 = await store.addCourseClass(lesson, "Class 1");
    const c2 = await store.addCourseClass(store.index.items.get(lesson.id)!, "Class 2");
    expect(c1.kind).toBe("class");
    expect(c1.path).toBe(`${base}/UX Immersion/Lesson 1/Class 1/Class 1.md`);
    expect(store.index.partLabel(c1)).toBe("Class 1 of 2");
    expect(store.index.partLabel(store.index.items.get(c2.id)!)).toBe("Class 2 of 2");
    expect(store.index.courseParent(store.index.items.get(c1.id)!)?.id).toBe(lesson.id);
    // classes are not lessons: the lesson count of the course is still 1
    expect(store.index.courseParts(store.index.items.get(course.id)!).filter((i) => i.kind === "lesson")).toHaveLength(1);
    // files go into the class folder
    mem.external.set("/Users/you/Desktop/worksheet.pdf", "w");
    await store.addCourseFiles(store.index.items.get(c1.id)!, ["/Users/you/Desktop/worksheet.pdf"]);
    expect(mem.files.has(`${base}/UX Immersion/Lesson 1/Class 1/worksheet.pdf`)).toBe(true);
  });

  it("a certificate is the file named Certificate in a course or program folder; it never overwrites", async () => {
    const { mem, store } = await fresh();
    const course = await store.createItem("courses", "Speaking Up At Work", "", {});
    expect(store.index.isCertified(course)).toBe(false);
    mem.external.set("/Users/you/Desktop/mycert.pdf", "A");
    mem.external.set("/Users/you/Desktop/other.pdf", "B");
    await store.addCertificate({ course }, "/Users/you/Desktop/mycert.pdf");
    const c = store.index.items.get(course.id)!;
    expect(c.path).toBe("Courses/Speaking Up At Work/Speaking Up At Work.md");
    expect(store.index.certificateOf("Courses/Speaking Up At Work")).toBe("Courses/Speaking Up At Work/Certificate.pdf");
    expect(c.fields["Certification"]).toBe("Yes");
    expect(store.index.isCertified(c)).toBe(true);
    // the certificate isn't listed as an ordinary file
    expect(store.index.courseFiles(c)).toEqual({ attached: [], inFolder: [] });
    // a second one is kept beside it
    await store.addCertificate({ course: c }, "/Users/you/Desktop/other.pdf");
    expect(mem.files.get("Courses/Speaking Up At Work/Certificate.pdf")?.text).toBe("A");
    expect(mem.files.has("Courses/Speaking Up At Work/Certificate 2.pdf")).toBe(true);
    // a program (only a folder) can hold one too
    await store.createProgram("IBM", "Course 1");
    mem.external.set("/Users/you/Desktop/ibm.pdf", "C");
    await store.addCertificate({ programDir: "Courses/IBM" }, "/Users/you/Desktop/ibm.pdf");
    expect(store.index.certificateOf("Courses/IBM")).toBe("Courses/IBM/Certificate.pdf");
  });
});

import { projectPages, cardKey } from "../ui/Board";
describe("the artboard's pages (tabs in the sidebar, icons on the artboard)", () => {
  it("lists Overview, then the sections in order, then Documentation", async () => {
    const { store } = await fresh();
    const p = await store.createProject("Venture", "Personal", {}, ["overview", "02 Market Research", "03 Customer Development", "docs"]);
    const pages = projectPages(store.index, store.index.items.get(p.id)!);
    expect(pages.map((x) => x.title)).toEqual(["Overview", "Market Research", "Customer Development", "Documentation"]);
    expect(pages[0].open).toEqual({ view: "item", id: p.id, page: "details" });
    const bare = await store.createProject("Bare", "Personal", {}, []);
    expect(projectPages(store.index, store.index.items.get(bare.id)!)).toEqual([]);
  });

  it("gives every kind of card its own key", () => {
    expect(cardKey({ id: "1", type: "page", page: "overview", x: 0, y: 0 })).toBe("p:overview");
    expect(cardKey({ id: "2", type: "file", file: "a.pdf", x: 0, y: 0 })).toBe("f:a.pdf");
    expect(cardKey({ id: "3", type: "text", x: 0, y: 0 })).toBe("t:3");
  });
});

describe("loose files in Courses", () => {
  it("files inside a course or lesson folder (and hidden files) are not 'loose'; only real strays are", async () => {
    const { mem, store } = await fresh();
    const base = "Courses/UX Certificate";
    await store.createProgram("UX Certificate", "Intro to UX Design");
    const fe = await store.addCourseToProgram(base, "Front-End Development");
    const l1 = await store.addCourseLesson(fe, "1 - Getting Started with HTML & CSS");
    mem.dropFile(`${base}/Front-End Development/1.2 - Internet & the Web.pdf`, "PDF"); // in the course's folder
    mem.dropFile(`${base}/Front-End Development/${l1.title}/1.1 - Start.pdf`, "PDF"); // in the lesson's folder
    mem.dropFile("Courses/.DS_Store", "x");
    mem.dropFile(`${base}/Front-End Development Notes Week 3.pdf`, "PDF"); // a real stray, beside the course folders
    mem.dropFile("Courses/Random.pdf", "PDF");
    await store.rescan();
    expect(store.index.unfiled("courses").map((e) => e.path).sort()).toEqual([
      "Courses/Random.pdf",
      `${base}/Front-End Development Notes Week 3.pdf`,
    ]);
  });

  it("Put in… moves a stray into a course or lesson and lists it on that page; suggests by name", async () => {
    const { mem, store } = await fresh();
    const base = "Courses/UX Certificate";
    await store.createProgram("UX Certificate", "Intro to UX Design");
    const fe = await store.addCourseToProgram(base, "Front-End Development");
    const l1 = await store.addCourseLesson(fe, "1 - Getting Started with HTML & CSS");
    mem.dropFile(`${base}/Front-End Development Notes Week 3.pdf`, "PDF");
    await store.rescan();
    const stray = `${base}/Front-End Development Notes Week 3.pdf`;
    expect(store.index.suggestCourse("Front-End Development Notes Week 3.pdf")?.id).toBe(fe.id);
    expect(store.index.suggestCourse("Random.pdf")).toBeUndefined();
    const labels = store.index.courseTargets().map((t) => t.label);
    expect(labels).toContain("UX Certificate → Front-End Development → 1 - Getting Started with HTML & CSS");
    expect(labels).toContain("UX Certificate → Intro to UX Design");
    await store.moveLooseFileToCourse(stray, l1.id);
    expect(mem.files.has(stray)).toBe(false);
    expect(mem.files.has(`${base}/Front-End Development/${l1.title}/Front-End Development Notes Week 3.pdf`)).toBe(true);
    expect(store.index.items.get(l1.id)!.files).toEqual(["Front-End Development Notes Week 3.pdf"]);
    expect(store.index.unfiled("courses")).toEqual([]);
    // a course on its own gets a folder first
    const solo = await store.createItem("courses", "Spanish", "", {});
    mem.dropFile("Courses/verbs.pdf", "PDF");
    await store.rescan();
    await store.moveLooseFileToCourse("Courses/verbs.pdf", solo.id);
    expect(mem.files.has("Courses/Spanish/verbs.pdf")).toBe(true);
    expect(store.index.items.get(solo.id)!.path).toBe("Courses/Spanish/Spanish.md");
  });
});

describe("the new app organization", () => {
  it("is one flat list in the order asked for, with the folded apps hidden and every old id kept", () => {
    const visible = DEFAULT_MODULES.filter((m) => !m.hidden).map((m) => m.name);
    expect(visible).toEqual([
      "Life", "To-Do & Routines", "Projects", "Journal", "Job Tracker", "Library", "Courses", "Saved Content",
      "Creator Studio", "Wisdom Drops", "Recipes", "Wardrobe", "Health", "Organization", "Finance",
      "Family Tree & Archive", "Photos & Videos",
    ]);
    expect(DEFAULT_MODULES.filter((m) => m.hidden).map((m) => [m.id, m.foldedInto])).toEqual([
      ["quotes", "wisdom"],
      ["sops", "organization"],
      ["home", "organization"],
    ]);
    const ids = DEFAULT_MODULES.map((m) => m.id);
    for (const old of ["life", "todo", "projects", "journal", "quotes", "wisdom", "library", "courses", "sops", "saved", "creator", "photos", "wardrobe", "recipes", "home", "family", "medical", "finance", "jobs"]) {
      expect(ids).toContain(old);
    }
    const health = DEFAULT_MODULES.find((m) => m.id === "medical")!;
    expect(health.name).toBe("Health");
    expect(health.folder).toBe("Health/Medical");
    expect(DEFAULT_MODULES.some((m) => "group" in m)).toBe(false);
    expect(DEFAULT_MODULES.find((m) => m.id === "organization")!.sections).toEqual(["Backups", "AI Settings", "Tech Stack", "SOPs", "Bookmarks", "Home Inventory"]);
    // every folder is top-level except the ones folded into another app, which sit inside it
    for (const m of DEFAULT_MODULES) {
      const top = m.folder.split("/")[0];
      expect(["Knowledge", "Content", "Career", "Home"]).not.toContain(top === "Home" ? "Home" : top);
    }
    expect(DEFAULT_MODULES.find((m) => m.id === "life")!.folder).toBe("Life");
    expect(DEFAULT_MODULES.find((m) => m.id === "todo")!.folder).toBe("To-Do & Routines");
  });

  it("Wisdom Drops shows quotes and tweets too (with a Source type), and Organization shows SOPs and Home Inventory", async () => {
    const { store } = await fresh();
    const drop = await store.createItem("wisdom", "An insight", "", { "Source type": "Insight" });
    const quote = await store.createItem("quotes", "A quote", "", {});
    const sop = await store.createItem("sops", "How I back up", "", {});
    const home = await store.createItem("home", "Couch", "", {});
    const backup = await store.createItem("organization", "Backup drive", "Backups", {});
    expect(quote.path).toBe("Wisdom Drops/Quotes & Tweets/A quote.md");
    expect(sop.path).toBe("Organization/SOPs/How I back up.md");
    expect(home.path).toBe("Organization/Home Inventory/Couch.md");
    expect(backup.path).toBe("Organization/Backups/Backup drive.md");
    expect(store.index.inApp("wisdom").map((i) => i.id).sort()).toEqual([drop.id, quote.id].sort());
    expect(store.index.inApp("organization")).toHaveLength(3);
    expect(store.index.countFor("wisdom")).toBe(2);
    expect(store.index.countFor("organization")).toBe(3);
    expect(store.index.hostId("quotes")).toBe("wisdom");
    expect(store.index.hostId("life")).toBe("life");
    // searching the app finds the folded notes; the notes keep their own app id
    expect(store.index.search("quote", "wisdom").map((i) => i.id)).toEqual([quote.id]);
    expect(store.index.items.get(quote.id)!.module).toBe("quotes");
    // a drop can link to a Saved Content item, which stays where it is
    const saved = await store.createItem("saved", "A reel", "", {});
    await store.addLink(drop, saved, "saved content");
    expect(store.index.items.get(drop.id)!.links).toEqual([{ to: store.index.items.get(saved.id)!.id, kind: "saved content" }]);
    expect(store.index.items.get(saved.id)!.path).toBe("Saved Content/A reel.md");
    expect(store.index.backlinks(saved.id).map((b) => b.item.id)).toEqual([drop.id]);
  });
});

describe("moving the old folders to the new layout when LifeOS opens", () => {
  const note = (id: string, module: string, title: string, extra = "") => `---\nid: ${id}\nmodule: ${module}\ntitle: ${title}\n${extra}---\nBody of ${title}\n`;
  const oldLayout = (mem: MemoryStorage) => {
    mem.dropFile("Life/Plan/Goal.md", note("g1", "life", "Goal", "links:\n  - to: j1\n    kind: related\n"));
    mem.dropFile("Life/To-Do & Routines/Task.md", note("t1", "todo", "Task"));
    mem.dropFile("Knowledge/Courses/Spanish/Spanish.md", note("c1", "courses", "Spanish"));
    mem.dropFile("Knowledge/Courses/Spanish/slides.pdf", "PDF BYTES");
    mem.dropFile("Knowledge/Wisdom Drops/Drop.md", note("w1", "wisdom", "Drop", "links:\n  - to: q1\n    kind: related\n"));
    mem.dropFile("Knowledge/Quotes & Tweets/Quote.md", note("q1", "quotes", "Quote"));
    mem.dropFile("Knowledge/SOPs/Backup.md", note("s1", "sops", "Backup"));
    mem.dropFile("Home/Inventory/Couch.md", note("h1", "home", "Couch"));
    mem.dropFile("Content/Saved/Reel.md", note("sv1", "saved", "Reel"));
    mem.dropFile("Content/Creator Studio/Idea.md", note("cr1", "creator", "Idea"));
    mem.dropFile("Career/Job Tracker/Contact.md", note("jb1", "jobs", "Contact"));
    mem.dropFile("Journal/2026-11-11/2026-11-11.md", note("j1", "journal", "2026-11-11"));
    mem.dropFile("Projects/Personal/P/p.lifeos", note("p1", "projects", "P", "kind: project\n"));
    mem.dropFile("Recipes/Dal.md", note("r1", "recipes", "Dal"));
  };

  it("moves each old folder whole to its new place, keeping contents, ids and links, and logs it", async () => {
    const mem = new MemoryStorage(false);
    oldLayout(mem);
    mem.dropFile(".lifeos/courses-status-completed", "done"); // that one-time step already ran on the owner's Mac
    const before = new Map([...mem.files].map(([k, v]) => [k, v.text]));
    const store = new LifeStore(mem);
    await store.init();

    const expected: Record<string, string> = {
      "Life/Plan/Goal.md": "Life/Goal.md",
      "Life/To-Do & Routines/Task.md": "To-Do & Routines/Task.md",
      "Knowledge/Courses/Spanish/Spanish.md": "Courses/Spanish/Spanish.md",
      "Knowledge/Courses/Spanish/slides.pdf": "Courses/Spanish/slides.pdf",
      "Knowledge/Wisdom Drops/Drop.md": "Wisdom Drops/Drop.md",
      "Knowledge/Quotes & Tweets/Quote.md": "Wisdom Drops/Quotes & Tweets/Quote.md",
      "Knowledge/SOPs/Backup.md": "Organization/SOPs/Backup.md",
      "Home/Inventory/Couch.md": "Organization/Home Inventory/Couch.md",
      "Content/Saved/Reel.md": "Saved Content/Reel.md",
      "Content/Creator Studio/Idea.md": "Creator Studio/Idea.md",
      "Career/Job Tracker/Contact.md": "Job Tracker/Contact.md",
      // left exactly as they are
      "Journal/2026-11-11/2026-11-11.md": "Journal/2026-11-11/2026-11-11.md",
      "Projects/Personal/P/p.lifeos": "Projects/Personal/P/p.lifeos",
      "Recipes/Dal.md": "Recipes/Dal.md",
    };
    for (const [from, to] of Object.entries(expected)) {
      expect(mem.files.get(to)?.text, to).toBe(before.get(from)); // same contents, nothing lost or rewritten
      if (from !== to) expect(mem.files.has(from), from).toBe(false); // moved, not copied
    }
    expect(mem.files.size - [...mem.files.keys()].filter((k) => k.startsWith(".lifeos/")).length).toBe(before.size - 1);
    // every note is still found, in the right app, with its id and links
    expect(store.index.items.get("g1")!.module).toBe("life");
    expect(store.index.items.get("g1")!.links).toEqual([{ to: "j1", kind: "related" }]);
    expect(store.index.items.get("q1")!.module).toBe("quotes");
    expect(store.index.items.get("t1")!.path).toBe("To-Do & Routines/Task.md");
    expect(store.index.inApp("wisdom").map((i) => i.id).sort()).toEqual(["q1", "w1"]);
    expect(store.index.inApp("organization").map((i) => i.id).sort()).toEqual(["h1", "s1"]);
    expect(store.index.backlinks("q1").map((b) => b.item.id)).toEqual(["w1"]);
    // it says what it did
    expect(store.moveLog.filter((l) => l.includes(" moved ")).length).toBe(10);
    expect(store.moveLog.some((l) => l.includes('moved "Knowledge/Courses" to "Courses"'))).toBe(true);
    expect(mem.files.get(".lifeos/folder-moves.log")!.text).toContain('moved "Content/Saved" to "Saved Content"');
    // the old category folders had nothing else, so they are gone
    for (const dir of ["Knowledge", "Content", "Career", "Home", "Life (old)"]) expect(await mem.exists(dir), dir).toBe(false);
    // opening again moves nothing
    await store.openRoot("");
    expect(store.moveLog).toEqual([]);
    expect(mem.files.get("Courses/Spanish/slides.pdf")?.text).toBe("PDF BYTES");
  });

  it("leaves a folder where it is if its new place already exists, and keeps a category folder that still has something in it", async () => {
    const mem = new MemoryStorage(false);
    mem.dropFile("Courses/Existing.md", note("e1", "courses", "Existing"));
    mem.dropFile("Knowledge/Courses/Old.md", note("c9", "courses", "Old"));
    mem.dropFile("Knowledge/SOPs/Backup.md", note("s1", "sops", "Backup"));
    mem.dropFile("Knowledge/.DS_Store", "finder junk");
    const store = new LifeStore(mem);
    await store.init();
    expect(mem.files.has("Knowledge/Courses/Old.md")).toBe(true); // not moved: "Courses" already existed
    expect(mem.files.has("Courses/Old.md")).toBe(false);
    expect(mem.files.get("Courses/Existing.md")).toBeDefined();
    expect(mem.files.has("Organization/SOPs/Backup.md")).toBe(true);
    expect(store.moveLog.some((l) => l.includes('left "Knowledge/Courses" where it is'))).toBe(true);
    expect(store.moveLog.some((l) => l.includes('kept "Knowledge"'))).toBe(true);
    expect(mem.files.get("Knowledge/.DS_Store")?.text).toBe("finder junk");
  });

  it("turns Life/Plan into Life even though Life is its parent, and keeps anything else that was in Life", async () => {
    const mem = new MemoryStorage(false);
    mem.dropFile("Life/Plan/Goal.md", note("g1", "life", "Goal"));
    mem.dropFile("Life/To-Do & Routines/Task.md", note("t1", "todo", "Task"));
    mem.dropFile("Life/loose notes.txt", "not in any app");
    const store = new LifeStore(mem);
    await store.init();
    expect(mem.files.get("Life/Goal.md")?.text).toContain("Body of Goal");
    expect(mem.files.has("To-Do & Routines/Task.md")).toBe(true);
    expect(mem.files.get("Life (old)/loose notes.txt")?.text).toBe("not in any app");
    expect(store.moveLog.some((l) => l.includes('kept "Life (old)"'))).toBe(true);
    expect(store.index.items.get("g1")!.path).toBe("Life/Goal.md");
  });

  it("puts everything back if a move fails half-way", async () => {
    class Flaky extends MemoryStorage {
      async renameDir(from: string, to: string) {
        if (from === "Life (old)/Plan") throw new Error("disk trouble");
        return super.renameDir(from, to);
      }
    }
    const mem = new Flaky(false);
    mem.dropFile("Life/Plan/Goal.md", note("g1", "life", "Goal"));
    const store = new LifeStore(mem);
    await store.init();
    expect(mem.files.get("Life/Plan/Goal.md")?.text).toContain("Body of Goal");
    expect(mem.files.has("Life (old)/Plan/Goal.md")).toBe(false);
    expect(store.moveLog.some((l) => l.includes("could not move") && l.includes("disk trouble"))).toBe(true);
  });
});
