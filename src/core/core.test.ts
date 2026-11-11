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
    expect(moduleForPath("Life/To-Do & Routines/x.md", DEFAULT_MODULES)?.id).toBe("todo");
    expect(moduleForPath("Life/Plan/x.md", DEFAULT_MODULES)?.id).toBe("life");
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
    expect([...mem.files.keys()].every((k) => k.startsWith(".trash/"))).toBe(true);
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
    for (const f of ["Content/Saved", "Life/To-Do & Routines", "Journal", "Projects", "Health/Medical"]) {
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
    const html = renderMarkdown("Morning.\n\n![](my%20photo.jpg)\n\n![](voice.m4a)\n\nEvening.", (n) => `file://${n}`);
    expect(html).toContain('<img class="md-img" src="file://my photo.jpg"');
    expect(html).toContain('<audio controls');
    expect(html.indexOf("Morning")).toBeLessThan(html.indexOf("<img"));
    expect(html.indexOf("<audio")).toBeLessThan(html.indexOf("Evening"));
  });
});
