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
    const base = "Knowledge/Courses/UX Certificate";
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
    mem.dropFile("Knowledge/Courses/Old Course.md", '---\nid: o1\ntitle: "Old Course"\nStatus: Want\n---\n');
    mem.dropFile("Knowledge/Courses/Prog/Prog Course/Prog Course.md", '---\nid: o2\ntitle: "Prog Course"\n---\n');
    mem.dropFile("Knowledge/Courses/Done Course.md", '---\nid: o3\ntitle: "Done Course"\nStatus: Done\n---\n');
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
    expect(first.path).toBe("Knowledge/Courses/Spanish Program/Spanish 101/Spanish 101.md");
    expect(mem.files.has("Knowledge/Courses/Spanish Program/Spanish Program.md")).toBe(false);
    const second = await store.addCourseToProgram("Knowledge/Courses/Spanish Program", "Spanish 102");
    expect(second.fields["Part"]).toBe(2);
    const dir = await store.renameProgram("Knowledge/Courses/Spanish Program", "Spanish");
    expect(dir).toBe("Knowledge/Courses/Spanish");
    expect(mem.files.has("Knowledge/Courses/Spanish/Spanish 101/Spanish 101.md")).toBe(true);
    expect(store.index.programCourses(dir).map((c) => c.title)).toEqual(["Spanish 101", "Spanish 102"]);
  });

  it("adding a lesson to a course makes it a folder; renaming the course renames its folder with everything inside", async () => {
    const { mem, store } = await fresh();
    const c = await store.createItem("courses", "Spanish", "", {});
    const lesson = await store.addCourseLesson(c, "Lesson 1");
    expect(lesson.path).toBe("Knowledge/Courses/Spanish/Lesson 1/Lesson 1.md");
    expect(lesson.kind).toBe("lesson");
    const folderItem = store.index.items.get(c.id)!;
    await store.saveItem({ ...folderItem, title: "Spanish Basics" }, { rename: true });
    expect(mem.files.has("Knowledge/Courses/Spanish Basics/Spanish Basics.md")).toBe(true);
    expect(mem.files.has("Knowledge/Courses/Spanish Basics/Lesson 1/Lesson 1.md")).toBe(true);
    expect(mem.files.has("Knowledge/Courses/Spanish/Spanish.md")).toBe(false);
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
    expect(c.path).toBe("Knowledge/Courses/Spanish/Spanish.md");
    expect(c.files).toEqual(["slides.pdf", "notes.md", "board.png", "Lesson 1.note"]);
    for (const f of c.files) expect(mem.files.has(`Knowledge/Courses/Spanish/${f}`)).toBe(true);
    // a second file with the same name is kept, with " 2", never overwritten
    mem.external.set("/Users/you/Downloads/slides.pdf", "y");
    await store.addCourseFiles(c, ["/Users/you/Downloads/slides.pdf"]);
    expect(store.index.items.get(course.id)!.files).toContain("slides 2.pdf");
    expect(mem.files.get("Knowledge/Courses/Spanish/slides.pdf")?.text).toBe("x");
  });

  it("shows 'Part 1 of 3' and 'Lesson 2 of 2', and lists the files in a folder, not ones moved away", async () => {
    const { mem, store } = await fresh();
    const base = "Knowledge/Courses/UX Certificate";
    await store.createProgram("UX Certificate", "Intro to UX Design");
    await store.addCourseToProgram(base, "UX Immersion");
    const fe = await store.addCourseToProgram(base, "Front-End Development");
    const l1 = await store.addCourseLesson(fe, "1 - Getting Started with HTML & CSS");
    const l2 = await store.addCourseLesson(store.index.items.get(fe.id)!, "2 - JavaScript & Your Portfolio Site");
    expect(store.index.partLabel(store.index.items.get(fe.id)!)).toBe("Part 3 of 3");
    expect(store.index.partLabel(store.index.programCourses(base)[0])).toBe("Part 1 of 3");
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
