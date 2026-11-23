// A project's artboard, like a Figma board. Text cards and pictures and videos sit
// wherever you drag them; the project's pages (Overview, Market Research…) and other
// files are small desktop-style icons: click one to select it, double-click to open it.
// The sidebar lists the same things (see ProjectView). Files dropped on the artboard are
// moved into the project's folder; the layout is saved in the project file (its `board:` list).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BoardCard, Item } from "../core/types";
import type { LifeIndex } from "../core/index";
import { dirName, extName, join } from "../core/paths";
import { ALL_PARTS, DOCS_KEY, MAIN_KEY, OVERVIEW_KEY, VENTURE_PART_KEYS, hasLeanCanvas, hasOverview } from "../core/projects";
import { inTauri } from "../core/storage";
import { newId } from "../core/ids";
import { useStore, type Route } from "./hooks";
import { Modal } from "./Modal";
import { renderMarkdown } from "./markdown";

const IMAGE = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"];
const VIDEO = [".mp4", ".mov", ".m4v", ".webm"];
const SAVE_DELAY = 700;

type Kind = "image" | "video" | "markdown" | "other";
function fileKind(name: string): Kind {
  const ext = extName(name).toLowerCase();
  if (IMAGE.includes(ext)) return "image";
  if (VIDEO.includes(ext)) return "video";
  if ([".md", ".markdown", ".txt"].includes(ext)) return "markdown";
  return "other";
}

/** Rough height of a card before it's on screen (pictures are tall, pages are short). */
function guessHeight(c: BoardCard): number {
  if (c.type === "page") return 100;
  if (c.type === "text") return 120;
  if (c.type === "section") return c.h ?? 220;
  if (c.type === "embed") return 120;
  const k = fileKind(c.file ?? "");
  return k === "image" || k === "video" ? Math.round((c.w ?? 260) * 0.75) + 30 : 100;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w + 16 && b.x < a.x + a.w + 16 && a.y < b.y + b.h + 16 && b.y < a.y + a.h + 16;

/** The first free spot (scanning right, then down) where a w×h card fits without covering another. */
function freeSpot(taken: Box[], w: number, h: number, start: { x: number; y: number }, maxX = 1300) {
  for (let y = start.y; y < start.y + 6000; y += 40) {
    for (let x = start.x; x < Math.max(start.x + w, maxX); x += 40) {
      const box = { x, y, w, h };
      if (!taken.some((t) => overlaps(box, t))) return { x, y };
    }
  }
  return start;
}

/** What a pasted web address is: a Claude artifact, a Claude chat, or any other link. */
export function embedKind(url: string): "artifact" | "chat" | "link" {
  try {
    const u = new URL(url);
    if (/(^|\.)claude\.ai$/.test(u.hostname)) return /\/artifacts?\//.test(u.pathname) ? "artifact" : "chat";
  } catch {
    /* not an address */
  }
  return "link";
}
const EMBED_ICON = {
  artifact: "M12 3v5 M12 16v5 M3 12h5 M16 12h5 M6 6l3 3 M15 15l3 3 M18 6l-3 3 M9 15l-3 3",
  chat: "M4 5h16v11H9l-5 4V5z",
  link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1 M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
} as const;
const EMBED_LABEL = { artifact: "Claude artifact", chat: "Claude chat", link: "Link" } as const;

/** The point on the edge of a box that faces another point (where an arrow starts or ends). */
function edgePoint(b: Box, toward: { x: number; y: number }) {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const t = Math.min(dx !== 0 ? b.w / 2 / Math.abs(dx) : Infinity, dy !== 0 ? b.h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * t, y: cy + dy * t };
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;

export interface PageInfo {
  key: string;
  title: string;
  open: Route;
}

/** The project's pages, in order: Main (its details file, main.md), its sections, then Documentation. */
export function projectPages(index: LifeIndex, project: Item): PageInfo[] {
  const parts = index.partsOf(project);
  const pages: PageInfo[] = [];
  if (parts.main) pages.push({ key: MAIN_KEY, title: "Main", open: { view: "item", id: parts.main.id } });
  // Only a project that has no main.md yet (it is made the first time the project opens) shows its own text as the Overview.
  else if (hasOverview(project.body)) pages.push({ key: OVERVIEW_KEY, title: "Overview", open: { view: "item", id: project.id, page: "details" } });
  for (const s of parts.sections) pages.push({ key: s.id, title: s.title, open: { view: "item", id: s.id } });
  if (parts.docs) pages.push({ key: parts.docs.id, title: "Documentation", open: { view: "item", id: parts.docs.id } });
  return pages;
}

/** Which card a sidebar entry or an icon stands for. */
export const cardKey = (c: BoardCard) => (c.type === "page" ? `p:${c.page}` : c.type === "file" ? `f:${c.file}` : `t:${c.id}`);

export function Board({ project, go }: { project: Item; go: (r: Route) => void }) {
  const store = useStore();
  const parts = store.index.partsOf(project);
  const dir = dirName(project.path);

  const pages = projectPages(store.index, project);

  // Saved cards, plus a bcard for any page or file that isn't on the Board yet.
  function withMissing(saved: BoardCard[]): BoardCard[] {
    const out = saved.filter((c) => {
      if (c.type === "page") return pages.some((p) => p.key === c.page);
      if (c.type === "file") return project.files.includes(c.file ?? "");
      return true;
    });
    const onBoard = new Set(out.map((c) => (c.type === "page" ? `p:${c.page}` : c.type === "file" ? `f:${c.file}` : "")));
    const taken: Box[] = out.filter((c) => c.type !== "section" && c.type !== "arrow").map((c) => ({ x: c.x, y: c.y, w: c.w ?? 240, h: guessHeight(c) }));
    const place = (card: BoardCard) => {
      const at = freeSpot(taken, card.w ?? 240, guessHeight(card), { x: 24, y: 24 }, 600);
      const placed = { ...card, ...at };
      taken.push({ x: placed.x, y: placed.y, w: placed.w ?? 240, h: guessHeight(placed) });
      out.push(placed);
    };
    for (const p of pages) {
      if (!onBoard.has(`p:${p.key}`)) place({ id: `auto-p-${p.key}`, type: "page", page: p.key, x: 0, y: 0, w: 96 });
    }
    for (const f of project.files) {
      if (!onBoard.has(`f:${f}`)) {
        const media = fileKind(f) === "image" || fileKind(f) === "video";
        place({ id: `auto-f-${f}`, type: "file", file: f, x: 0, y: 0, w: media ? 260 : 96 });
      }
    }
    return out;
  }

  const savedKey = JSON.stringify(project.board ?? []) + project.files.join("|") + pages.map((p) => p.key).join("|");
  const [cards, setCards] = useState<BoardCard[]>(() => withMissing(project.board ?? []));
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const busy = useRef(false); // dragging or typing: don't replace local cards with the saved ones
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const boardEl = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState("");
  const [reading, setReading] = useState(""); // a Markdown file open in the reader
  const lastClick = useRef({ key: "", at: 0 });
  // Zoom and pan, sections, arrows and link cards (the design's Figma-like tools).
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const [tool, setTool] = useState<"select" | "hand" | "arrow">("select");
  const [arrowFrom, setArrowFrom] = useState("");
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  const [linking, setLinking] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");

  /** One click selects; a second click on the same icon within a moment opens it. */
  function clickIcon(key: string, open: () => void) {
    const now = Date.now();
    if (lastClick.current.key === key && now - lastClick.current.at < 450) {
      lastClick.current = { key: "", at: 0 };
      open();
      return;
    }
    lastClick.current = { key, at: now };
    setSelected(key);
  }

  // The sidebar can select something on the artboard (like picking a layer in Figma).
  useEffect(() => {
    const onPick = (e: Event) => {
      const key = String((e as CustomEvent).detail ?? "");
      setSelected(key);
      const el = boardEl.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
      el?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    };
    window.addEventListener("board-select", onPick);
    return () => window.removeEventListener("board-select", onPick);
  }, []);

  // Measure the cards so arrows can join their edges.
  useLayoutEffect(() => {
    const el = boardEl.current;
    if (!el) return;
    const next: Record<string, { w: number; h: number }> = {};
    el.querySelectorAll<HTMLElement>("[data-card]").forEach((n) => {
      next[n.dataset.card!] = { w: n.offsetWidth, h: n.offsetHeight };
    });
    setSizes((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "Escape") {
        setTool("select");
        setArrowFrom("");
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected.startsWith("a:")) {
        e.preventDefault();
        const next = cardsRef.current.filter((c) => !(c.type === "arrow" && `a:${c.id}` === selected));
        setCards(next);
        setSelected("");
        save(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // Pinching (or Ctrl + scroll) zooms the Board.
  useEffect(() => {
    const el = boardEl.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * Math.exp(-e.deltaY * 0.01) * 100) / 100)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (!busy.current) setCards(withMissing(project.board ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  async function save(next: BoardCard[]) {
    clearTimeout(timer.current);
    busy.current = false;
    setStatus("Saving…");
    try {
      await store.saveBoard(project, next.map((c) => (c.id.startsWith("auto-") ? { ...c, id: newId() } : c)));
      setStatus("Saved");
    } catch (e) {
      setStatus(`Couldn't save: ${e}`);
    }
  }
  function saveSoon(next: BoardCard[]) {
    busy.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(cardsRef.current), SAVE_DELAY);
    setCards(next);
  }
  // Save anything pending when leaving the Board.
  useEffect(
    () => () => {
      if (busy.current) {
        clearTimeout(timer.current);
        store.saveBoard(project, cardsRef.current.map((c) => (c.id.startsWith("auto-") ? { ...c, id: newId() } : c)));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Where every card is on screen right now (measured, so tall pictures count). */
  function takenBoxes(): Box[] {
    const el = boardEl.current;
    return cardsRef.current
      .filter((c) => c.type !== "section" && c.type !== "arrow")
      .map((c) => {
      const node = el?.querySelector<HTMLElement>(`[data-card="${c.id}"]`);
      return { x: c.x, y: c.y, w: c.w ?? 240, h: node?.offsetHeight ?? guessHeight(c) };
      });
  }

  /** A free spot in the part of the Board you can see. */
  function visibleSpot(w = 240, h = 140) {
    const el = boardEl.current;
    const z = zoomRef.current;
    const start = { x: Math.round((el?.scrollLeft ?? 0) / z) + 24, y: Math.round((el?.scrollTop ?? 0) / z) + 24 };
    return freeSpot(takenBoxes(), w, h, start, start.x + Math.max(600, (el?.clientWidth ?? 1000) / z - w - 24));
  }

  function addText() {
    const at = visibleSpot();
    const card: BoardCard = { id: newId(), type: "text", text: "", x: at.x, y: at.y, w: 240 };
    const next = [...cardsRef.current, card];
    setCards(next);
    save(next);
  }

  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");
  async function addMarkdown() {
    const title = newName.trim();
    if (!title) return;
    setNaming(false);
    setNewName("");
    if (busy.current) await save(cardsRef.current);
    try {
      await store.createBoardMarkdown(store.index.items.get(project.id) ?? project, title, visibleSpot(300, 160));
      setStatus(`Created ${title}`);
    } catch (e) {
      setStatus(`Couldn't create: ${e}`);
    }
  }

  async function addFiles(paths: string[], at = visibleSpot(260, 220)) {
    if (!paths.length) return;
    // Keep any unsaved moves/typing before the files land.
    if (busy.current) await save(cardsRef.current);
    setStatus("Adding files…");
    try {
      await store.addBoardFiles(store.index.items.get(project.id) ?? project, paths, at);
      setStatus(`Moved ${paths.length} file${paths.length === 1 ? "" : "s"} into the project folder`);
    } catch (e) {
      setStatus(`Couldn't add: ${e}`);
    }
  }

  // Files dragged in from Finder (the Mac app only).
  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;
  const [dropping, setDropping] = useState(false);
  useEffect(() => {
    if (!inTauri()) return;
    let un: (() => void) | undefined;
    let cancelled = false;
    import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
      getCurrentWebview()
        .onDragDropEvent((e) => {
          const p = e.payload;
          if (p.type === "over" || p.type === "enter") setDropping(true);
          else if (p.type === "leave") setDropping(false);
          else if (p.type === "drop") {
            setDropping(false);
            const el = boardEl.current;
            if (!el) return;
            const r = el.getBoundingClientRect();
            const ratio = window.devicePixelRatio || 1;
            const z = zoomRef.current;
            const x = (p.position.x / ratio - r.left + el.scrollLeft) / z;
            const y = (p.position.y / ratio - r.top + el.scrollTop) / z;
            addFilesRef.current(p.paths, { x: Math.max(0, x - 40), y: Math.max(0, y - 20) });
          }
        })
        .then((u) => {
          if (cancelled) u();
          else un = u;
        }),
    );
    return () => {
      cancelled = true;
      un?.();
    };
  }, []);

  // ---------- dragging and resizing ----------
  function startDrag(e: React.PointerEvent, card: BoardCard, mode: "move" | "resize", onClick?: () => void) {
    if (e.button !== 0) return;
    if (tool === "hand") return;
    e.preventDefault();
    e.stopPropagation();
    busy.current = true;
    const z = zoomRef.current;
    const sx = e.clientX;
    const sy = e.clientY;
    const start = { x: card.x, y: card.y, w: card.w ?? 240, h: card.h ?? guessHeight(card) };
    // Moving a section carries the cards that sit inside it.
    const carried: Record<string, { x: number; y: number }> = {};
    if (card.type === "section" && mode === "move") {
      for (const c of cardsRef.current) {
        if (c.id === card.id || c.type === "section" || c.type === "arrow") continue;
        const size = sizes[c.id] ?? { w: c.w ?? 240, h: guessHeight(c) };
        const cx = c.x + size.w / 2;
        const cy = c.y + size.h / 2;
        if (cx >= start.x && cx <= start.x + start.w && cy >= start.y && cy <= start.y + start.h) carried[c.id] = { x: c.x, y: c.y };
      }
    }
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / z;
      const dy = (ev.clientY - sy) / z;
      if (Math.abs(dx) + Math.abs(dy) > 4 / z) moved = true;
      setCards((cs) =>
        cs.map((c) => {
          if (c.id === card.id) {
            if (mode === "move") return { ...c, x: Math.max(0, Math.round(start.x + dx)), y: Math.max(0, Math.round(start.y + dy)) };
            return c.type === "section"
              ? { ...c, w: Math.min(3000, Math.max(160, Math.round(start.w + dx))), h: Math.min(3000, Math.max(100, Math.round(start.h + dy))) }
              : { ...c, w: Math.min(1000, Math.max(140, Math.round(start.w + dx))) };
          }
          const from = carried[c.id];
          return from ? { ...c, x: Math.max(0, Math.round(from.x + dx)), y: Math.max(0, Math.round(from.y + dy)) } : c;
        }),
      );
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) save(cardsRef.current);
      else {
        busy.current = false;
        onClick?.();
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // ---------- the Hand tool: drag the empty Board to move around ----------
  function startPan(e: React.PointerEvent) {
    const el = boardEl.current;
    if (tool !== "hand" || !el || e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const left = el.scrollLeft;
    const top = el.scrollTop;
    const onMove = (ev: PointerEvent) => {
      el.scrollLeft = left - (ev.clientX - sx);
      el.scrollTop = top - (ev.clientY - sy);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // ---------- zoom ----------
  const setZoomTo = (z: number) => setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100)));
  function fit() {
    const el = boardEl.current;
    const real = cardsRef.current.filter((c) => c.type !== "arrow");
    if (!el || real.length === 0) return setZoom(1);
    const right = Math.max(...real.map((c) => c.x + (sizes[c.id]?.w ?? c.w ?? 240)));
    const bottom = Math.max(...real.map((c) => c.y + (sizes[c.id]?.h ?? guessHeight(c))));
    const z = Math.min(1, (el.clientWidth - 40) / (right + 24), (el.clientHeight - 40) / (bottom + 24));
    setZoomTo(z);
    el.scrollTo({ left: 0, top: 0 });
  }

  // ---------- arrows ----------
  /** Cards that were placed automatically get a real id once an arrow needs to point at them. */
  function pickForArrow(card: BoardCard) {
    if (!arrowFrom) {
      setArrowFrom(card.id);
      setStatus("Now click the card the arrow points to (Esc to stop)");
      return;
    }
    if (arrowFrom === card.id) return;
    // ids of cards placed automatically change when they are first saved, so give them real ones first
    const renamed = new Map<string, string>();
    const next = cardsRef.current.map((c) => {
      if (!c.id.startsWith("auto-")) return c;
      const id = newId();
      renamed.set(c.id, id);
      return { ...c, id };
    });
    const from = renamed.get(arrowFrom) ?? arrowFrom;
    const to = renamed.get(card.id) ?? card.id;
    const arrow: BoardCard = { id: newId(), type: "arrow", x: 0, y: 0, from, to };
    const all = [...next, arrow];
    setCards(all);
    setArrowFrom("");
    setStatus("");
    save(all);
  }

  // ---------- sections and link cards ----------
  function addSection() {
    const at = visibleSpot(420, 260);
    const card: BoardCard = { id: newId(), type: "section", text: "Section", x: at.x, y: at.y, w: 420, h: 260 };
    const next = [...cardsRef.current, card];
    setCards(next);
    save(next);
  }
  function addEmbed() {
    const url = linkUrl.trim();
    if (!/^https?:\/\//i.test(url)) return;
    const kind = embedKind(url);
    const at = visibleSpot(260, 130);
    const card: BoardCard = {
      id: newId(),
      type: "embed",
      embed: kind,
      url,
      text: linkTitle.trim() || (kind === "link" ? new URL(url).hostname : EMBED_LABEL[kind]),
      x: at.x,
      y: at.y,
      w: 260,
    };
    const next = [...cardsRef.current, card];
    setCards(next);
    setLinking(false);
    setLinkUrl("");
    setLinkTitle("");
    save(next);
  }

  async function remove(card: BoardCard) {
    if (card.type === "file") {
      if (!window.confirm(`Move "${card.file}" to the LifeOS trash? (You can get it back from the hidden .trash folder.)`)) return;
    } else if (card.type === "text" && card.text?.trim()) {
      if (!window.confirm("Delete this text card?")) return;
    }
    if (busy.current) await save(cardsRef.current);
    await store.removeBoardCard(store.index.items.get(project.id) ?? project, card);
  }

  // ---------- adding a section ----------
  const haveSections = new Set(parts.sections.map((s) => s.path.split("/").pop()!.replace(/\.md$/, "")));
  const missingParts = ALL_PARTS.filter((p) =>
    p.key === OVERVIEW_KEY ? !hasLeanCanvas(parts.main ? parts.main.body : project.body) : p.key === DOCS_KEY ? !parts.docs : !haveSections.has(p.key),
  );

  const width = Math.max(2400, ...cards.map((c) => c.x + (c.w ?? 240) + 400));
  const height = Math.max(1600, ...cards.map((c) => c.y + 900));

  return (
    <div className="board-wrap">
      <div className="board-bar">
        {missingParts.length > 0 && (
          <select
            value={adding}
            onChange={async (e) => {
              const key = e.target.value;
              if (!key) return;
              setAdding(key);
              const keys = key === "venture" ? missingParts.map((p) => p.key).filter((k) => VENTURE_PART_KEYS.includes(k)) : [key];
              for (const k of keys) await store.addPart(store.index.items.get(project.id) ?? project, k);
              setAdding("");
            }}
          >
            <option value="">+ Add a section…</option>
            {missingParts.filter((p) => VENTURE_PART_KEYS.includes(p.key)).length > 1 && (
              <option value="venture">The whole Venture Ideation System</option>
            )}
            {missingParts.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        )}
        <span className="muted small board-status">{status}</span>
        <span className="right">
          <button onClick={() => store.storage.reveal(dir)}>Show in Finder</button>
        </span>
      </div>
      <div className="board-dock" role="toolbar" aria-label="Board tools">
        {(
          [
            { id: "select", label: "Select", d: "M5 3l14 8-6 2-2 6z" },
            { id: "hand", label: "Hand", d: "M8 12V6a1.5 1.5 0 013 0v5 M11 11V4.5a1.5 1.5 0 013 0V11 M14 11V6a1.5 1.5 0 013 0v7a6 6 0 01-6 6 5 5 0 01-4-2l-3-4a1.5 1.5 0 012.3-1.8L8 14" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            className={`dock-btn ${tool === t.id ? "on" : ""}`}
            aria-pressed={tool === t.id}
            onClick={() => {
              setTool(t.id);
              setArrowFrom("");
              setStatus(t.id === "hand" ? "Drag the Board to move around" : "");
            }}
          >
            <DockIcon d={t.d} />
            {t.label}
          </button>
        ))}
        <button className="dock-btn" onClick={addText}>
          <DockIcon d="M5 6h14 M12 6v13 M9 19h6" />
          Text
        </button>
        <button className="dock-btn" onClick={async () => addFiles(await store.storage.pickFiles())} title="Pictures, videos, notes and files">
          <DockIcon d="M12 16V5 M7.5 9.5L12 5l4.5 4.5 M5 19h14" />
          Add files
        </button>
        <button className="dock-btn" onClick={() => setLinking(true)} title="Put a Claude artifact, a Claude chat or any web link on the Board">
          <DockIcon d="M9 7l-5 5 5 5 M15 7l5 5-5 5" />
          Embed
        </button>
        <button className="dock-btn" onClick={addSection} title="A labelled area. Moving it moves the cards inside it">
          <DockIcon d="M4 6h5 M4 6v12h16V6h-7 M4 6h16" />
          Section
        </button>
        <button
          className={`dock-btn ${tool === "arrow" ? "on" : ""}`}
          aria-pressed={tool === "arrow"}
          onClick={() => {
            setTool("arrow");
            setArrowFrom("");
            setStatus("Click a card, then the card the arrow points to (Esc to stop)");
          }}
        >
          <DockIcon d="M5 19L19 5 M10 5h9v9" />
          Arrow
        </button>
        <button className="dock-btn" onClick={() => setNaming(true)}>
          <DockIcon d="M7 3h7l5 5v13H7z M14 3v5h5 M12 12v6 M9 15h6" />
          Add page
        </button>
      </div>
      <span className="zoom-control board-zoom" role="group" aria-label="Zoom">
        <button onClick={() => setZoomTo(zoom - 0.1)} aria-label="Zoom out">
          −
        </button>
        <span className="zoom-value">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoomTo(zoom + 0.1)} aria-label="Zoom in">
          +
        </button>
        <button onClick={fit}>Fit</button>
      </span>
      {store.storage.kind === "mac" && (
        <p className="muted small board-hint">Drag pictures, videos or files from Finder onto the Board. They're moved into this project's folder.</p>
      )}

      {naming && (
        <Modal close={() => setNaming(false)}>
          <h2>New Markdown page</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addMarkdown();
            }}
          >
            <label className="field">
              <span className="field-label">Name (it becomes the file name, ending in .md)</span>
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Ideas" />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setNaming(false)}>
                Cancel
              </button>
              <button className="primary" type="submit" disabled={!newName.trim()}>
                Create
              </button>
            </div>
          </form>
        </Modal>
      )}

      {linking && (
        <Modal close={() => setLinking(false)}>
          <h2>Link or Claude</h2>
          <p className="muted small">Paste the address of a Claude artifact, a Claude chat or any web page. The card opens it in your browser; only the address and title are saved.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addEmbed();
            }}
          >
            <div className="form-rows">
              <label className="field">
                <span className="field-label">Address</span>
                <input autoFocus value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://claude.ai/…" />
              </label>
              <label className="field">
                <span className="field-label">Title (optional)</span>
                <input value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} placeholder="e.g. Pricing ideas" />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setLinking(false)}>
                Cancel
              </button>
              <button className="primary" type="submit" disabled={!/^https?:\/\//i.test(linkUrl.trim())}>
                Add
              </button>
            </div>
          </form>
        </Modal>
      )}

      <div className={`board tool-${tool} ${dropping ? "dropping" : ""}`} ref={boardEl} onPointerDown={startPan}>
        <div className="board-scale" style={{ width: width * zoom, height: height * zoom }}>
        <div
          className="board-canvas"
          style={{ width, height, transform: `scale(${zoom})`, transformOrigin: "0 0" }}
          onPointerDown={(e) => e.target === e.currentTarget && setSelected("")}
        >
          {cards.filter((c) => c.type === "section").map((c) => (
            <div
              key={c.id}
              data-card={c.id}
              data-key={cardKey(c)}
              className={`bsection ${selected === cardKey(c) ? "selected" : ""}`}
              style={{ left: c.x, top: c.y, width: c.w ?? 420, height: c.h ?? 260 }}
            >
              <div className="bsection-bar" onPointerDown={(e) => startDrag(e, c, "move", () => setSelected(cardKey(c)))} title="Drag to move the section and its cards">
                <input
                  className="bsection-label"
                  value={c.text ?? ""}
                  placeholder="Section"
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(e) => saveSoon(cardsRef.current.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)))}
                />
                <button
                  className="bcard-x"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    const next = cardsRef.current.filter((x) => x.id !== c.id);
                    setCards(next);
                    save(next);
                  }}
                  title="Remove the section (its cards stay)"
                >
                  ×
                </button>
              </div>
              <span className="bcard-resize" onPointerDown={(e) => startDrag(e, c, "resize")} />
            </div>
          ))}

          <svg className="board-arrows" width={width} height={height} aria-hidden="true">
            <defs>
              <marker id="board-arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
                <path d="M1 1l7 4-7 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </marker>
            </defs>
            {cards
              .filter((c) => c.type === "arrow")
              .map((c) => {
                const a = cards.find((x) => x.id === c.from);
                const b = cards.find((x) => x.id === c.to);
                if (!a || !b) return null;
                const sa = sizes[a.id] ?? { w: a.w ?? 240, h: guessHeight(a) };
                const sb = sizes[b.id] ?? { w: b.w ?? 240, h: guessHeight(b) };
                const boxA = { x: a.x, y: a.y, w: sa.w, h: sa.h };
                const boxB = { x: b.x, y: b.y, w: sb.w, h: sb.h };
                const p1 = edgePoint(boxA, { x: boxB.x + boxB.w / 2, y: boxB.y + boxB.h / 2 });
                const p2 = edgePoint(boxB, { x: boxA.x + boxA.w / 2, y: boxA.y + boxA.h / 2 });
                const isSel = selected === `a:${c.id}`;
                return (
                  <g key={c.id} className={`board-arrow ${isSel ? "selected" : ""}`}>
                    <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className="board-arrow-line" markerEnd="url(#board-arrowhead)" />
                    <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className="board-arrow-hit" onPointerDown={(e) => { e.stopPropagation(); setSelected(`a:${c.id}`); }} />
                  </g>
                );
              })}
          </svg>
          {cards.filter((c) => c.type !== "section" && c.type !== "arrow").map((c) => {
            const key = cardKey(c);
            const isSel = selected === key;
            const style = { left: c.x, top: c.y, width: c.w ?? 240 };
            const media = c.type === "file" && (fileKind(c.file ?? "") === "image" || fileKind(c.file ?? "") === "video");

            // Pages and other files are desktop-style icons.
            if (c.type === "page" || (c.type === "file" && !media)) {
              const page = c.type === "page" ? pages.find((pp) => pp.key === c.page) : undefined;
              if (c.type === "page" && !page) return null;
              const name = c.type === "page" ? page!.title : c.file ?? "";
              const kind = c.type === "file" ? fileKind(name) : "page";
              const open = () => {
                if (page) go(page.open);
                else if (kind === "markdown") setReading(name);
                else store.storage.open(join(dir, name));
              };
              return (
                <div
                  key={c.id}
                  data-card={c.id}
                  data-key={key}
                  className={`bicon ${isSel ? "selected" : ""}`}
                  style={{ left: c.x, top: c.y }}
                  onPointerDown={(e) => (tool === "arrow" ? (e.stopPropagation(), pickForArrow(c)) : startDrag(e, c, "move", () => clickIcon(key, open)))}
                  title="Double-click to open · drag to move"
                >
                  <div className="bicon-img">
                    <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M7 3h7l5 5v13H7z M14 3v5h5" />
                    </svg>
                  </div>
                  <div className="bicon-label">{name}</div>
                  {isSel && c.type === "file" && (
                    <button className="bcard-x bicon-x" onPointerDown={(e) => e.stopPropagation()} onClick={() => remove(c)} title="Move to trash">
                      ×
                    </button>
                  )}
                </div>
              );
            }

            return (
              <div
                key={c.id}
                data-card={c.id}
                data-key={key}
                className={`bcard bcard-type-${c.type} ${isSel ? "selected" : ""} ${arrowFrom === c.id ? "arrow-from" : ""}`}
                style={style}
                onPointerDownCapture={(e) => {
                  if (tool === "arrow") {
                    e.stopPropagation();
                    e.preventDefault();
                    pickForArrow(c);
                    return;
                  }
                  setSelected(key);
                }}
              >
                <div className="bcard-grip" onPointerDown={(e) => startDrag(e, c, "move")} title="Drag to move">
                  <span className="bcard-grip-label">
                    {c.type === "embed" && (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d={EMBED_ICON[c.embed ?? "link"]} />
                      </svg>
                    )}
                    {c.type === "file" ? c.file : c.type === "embed" ? EMBED_LABEL[c.embed ?? "link"] : ""}
                  </span>
                  <button
                    className="bcard-x"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => remove(c)}
                    title={c.type === "file" ? "Move to trash" : "Delete"}
                  >
                    ×
                  </button>
                </div>
                {c.type === "embed" ? (
                  <div className={`bcard-embed bcard-embed-${c.embed ?? "link"}`}>
                    {c.embed === "artifact" && (
                      <div className="embed-preview" aria-hidden="true">
                        <span style={{ width: "60%" }} />
                        <span style={{ width: "90%" }} />
                        <span style={{ width: "75%" }} />
                        <span style={{ width: "40%" }} />
                      </div>
                    )}
                    <button className="bcard-embed-title link" onPointerDown={(e) => e.stopPropagation()} onClick={() => c.url && store.storage.openUrl(c.url)} title="Open in your browser">
                      {c.text}
                    </button>
                    <div className="muted small bcard-embed-url">
                      {c.embed === "link" ? (() => { try { return new URL(c.url ?? "").hostname; } catch { return c.url; } })() : "Opens in your browser"}
                    </div>
                  </div>
                ) : c.type === "text" ? (
                  <AutoText
                    value={c.text ?? ""}
                    onChange={(text) => saveSoon(cardsRef.current.map((x) => (x.id === c.id ? { ...x, text } : x)))}
                  />
                ) : (
                  <FileBody path={join(dir, c.file ?? "")} name={c.file ?? ""} selected={isSel} />
                )}
                <span className="bcard-resize" onPointerDown={(e) => startDrag(e, c, "resize")} />
              </div>
            );
          })}
          {cards.length === 0 && (
            <div className="board-empty muted">
              Empty board. Add text, or {store.storage.kind === "mac" ? "drop" : "add"} pictures, videos and files.
            </div>
          )}
        </div>
        </div>
      </div>
      {reading && <MarkdownReader path={join(dir, reading)} name={reading} close={() => setReading("")} />}
    </div>
  );
}

function AutoText({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      className="bcard-input"
      value={value}
      placeholder="Type something"
      autoFocus={!value}
      onChange={(e) => onChange(e.target.value)}
      rows={2}
    />
  );
}

/** A picture or video card on the artboard. */
function FileBody({ path, name, selected }: { path: string; name: string; selected: boolean }) {
  const store = useStore();
  const kind = fileKind(name);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    store.storage.fileUrl(path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [path, store.storage]);

  if (kind === "image" && url) {
    return (
      <div className="media-frame">
        <img className="bcard-media" src={url} alt={name} draggable={false} onDoubleClick={() => store.storage.open(path)} title="Double-click to open" />
        {selected && <Handles />}
      </div>
    );
  }
  if (kind === "video" && url) {
    return (
      <div className="media-frame media-video">
        <video className="bcard-media" src={url} controls preload="metadata" />
        {selected && <Handles />}
      </div>
    );
  }
  return (
    <button className="bcard-file" onClick={() => store.storage.open(path)} title="Open">
      <span className="bcard-file-icon">{kind === "image" ? "🖼️" : "🎬"}</span>
      <span>{name}</span>
    </button>
  );
}

/** A Markdown file opened from the artboard: read it in a big window, and edit it there. */
function MarkdownReader({ path, name, close }: { path: string; name: string; close: () => void }) {
  const store = useStore();
  const [text, setText] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const headRef = useRef(""); // fields at the top of the file, kept as they were
  useEffect(() => {
    let alive = true;
    store.storage.read(path).then((t) => {
      if (!alive) return;
      const raw = t ?? "";
      const head = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)?.[0] ?? "";
      headRef.current = head;
      setText(raw.slice(head.length));
    });
    return () => {
      alive = false;
    };
  }, [path, store.storage]);

  return (
    <Modal close={close}>
      <div className="md-reader">
        <h2>{name.replace(/\.[^.]+$/, "")}</h2>
        {editing ? (
          <textarea className="body-input" autoFocus value={text ?? ""} onChange={(e) => setText(e.target.value)} />
        ) : (
          <div className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(text === null ? "…" : text || "*Nothing written yet.*") }} />
        )}
        <div className="modal-actions">
          {editing ? (
            <button
              className="primary"
              onClick={async () => {
                await store.storage.write(path, headRef.current + (text ?? ""));
                setEditing(false);
              }}
            >
              Save
            </button>
          ) : (
            <>
              <button onClick={() => setEditing(true)}>Edit</button>
              <button className="primary" onClick={close}>
                Close
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function DockIcon({ d }: { d: string }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.split(" M").map((seg, i) => (
        <path key={i} d={(i === 0 ? "" : "M") + seg} />
      ))}
    </svg>
  );
}

function Handles() {
  return (
    <>
      <span className="handle tl" />
      <span className="handle tr" />
      <span className="handle bl" />
      <span className="handle br" />
    </>
  );
}
