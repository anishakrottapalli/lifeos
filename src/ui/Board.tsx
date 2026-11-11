// A project's Board: a freeform canvas, like a Figma board. Text cards,
// pictures, videos and files sit wherever you drag them, and the project's
// pages (Overview, Market Research, Documentation…) sit on it as cards you
// click to open. Files dropped on the Board are moved into the project's
// folder; the layout is saved in the project note (its `board:` list).

import { useEffect, useRef, useState } from "react";
import type { BoardCard, Item } from "../core/types";
import { dirName, extName, join } from "../core/paths";
import { ALL_PARTS, DOCS_KEY, OVERVIEW_KEY, VENTURE_PART_KEYS, hasOverview } from "../core/projects";
import { inTauri } from "../core/storage";
import { newId } from "../core/ids";
import { useStore, type Route } from "./hooks";

const IMAGE = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"];
const VIDEO = [".mp4", ".mov", ".m4v", ".webm"];
const SAVE_DELAY = 700;

type Kind = "image" | "video" | "other";
function fileKind(name: string): Kind {
  const ext = extName(name).toLowerCase();
  if (IMAGE.includes(ext)) return "image";
  if (VIDEO.includes(ext)) return "video";
  return "other";
}

/** A short plain-text taste of a page, for its card. */
function snippet(body: string): string {
  const lines = body
    .split("\n")
    .map((l) => l.replace(/^#+\s*|^[-*]\s*|\*\*|\|/g, "").trim())
    .filter((l) => l && !/^-+$/.test(l));
  const s = lines.slice(0, 3).join(" · ");
  return s.length > 120 ? s.slice(0, 117) + "…" : s;
}

/** Rough height of a card before it's on screen (pictures are tall, pages are short). */
function guessHeight(c: BoardCard): number {
  if (c.type === "page") return 110;
  if (c.type === "text") return 120;
  const k = fileKind(c.file ?? "");
  return k === "other" ? 70 : Math.round((c.w ?? 260) * 0.75) + 30;
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

interface PageInfo {
  key: string;
  title: string;
  body: string;
  open: Route;
}

export function Board({ project, go }: { project: Item; go: (r: Route) => void }) {
  const store = useStore();
  const parts = store.index.partsOf(project);
  const dir = dirName(project.path);

  // The project's pages, in order.
  const pages: PageInfo[] = [];
  if (hasOverview(project.body))
    pages.push({ key: OVERVIEW_KEY, title: "Overview", body: project.body, open: { view: "item", id: project.id, page: "details" } });
  for (const s of parts.sections) pages.push({ key: s.id, title: s.title, body: s.body, open: { view: "item", id: s.id } });
  if (parts.docs) pages.push({ key: parts.docs.id, title: "Documentation", body: parts.docs.body, open: { view: "item", id: parts.docs.id } });

  // Saved cards, plus a bcard for any page or file that isn't on the Board yet.
  function withMissing(saved: BoardCard[]): BoardCard[] {
    const out = saved.filter((c) => {
      if (c.type === "page") return pages.some((p) => p.key === c.page);
      if (c.type === "file") return project.files.includes(c.file ?? "");
      return true;
    });
    const onBoard = new Set(out.map((c) => (c.type === "page" ? `p:${c.page}` : c.type === "file" ? `f:${c.file}` : "")));
    const taken: Box[] = out.map((c) => ({ x: c.x, y: c.y, w: c.w ?? 240, h: guessHeight(c) }));
    const place = (card: BoardCard) => {
      const at = freeSpot(taken, card.w ?? 240, guessHeight(card), { x: 24, y: 24 }, 600);
      const placed = { ...card, ...at };
      taken.push({ x: placed.x, y: placed.y, w: placed.w ?? 240, h: guessHeight(placed) });
      out.push(placed);
    };
    for (const p of pages) {
      if (!onBoard.has(`p:${p.key}`)) place({ id: `auto-p-${p.key}`, type: "page", page: p.key, x: 0, y: 0, w: 200 });
    }
    for (const f of project.files) {
      if (!onBoard.has(`f:${f}`)) place({ id: `auto-f-${f}`, type: "file", file: f, x: 0, y: 0, w: 260 });
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
    return cardsRef.current.map((c) => {
      const node = el?.querySelector<HTMLElement>(`[data-card="${c.id}"]`);
      return { x: c.x, y: c.y, w: c.w ?? 240, h: node?.offsetHeight ?? guessHeight(c) };
    });
  }

  /** A free spot in the part of the Board you can see. */
  function visibleSpot(w = 240, h = 140) {
    const el = boardEl.current;
    const start = { x: (el?.scrollLeft ?? 0) + 24, y: (el?.scrollTop ?? 0) + 24 };
    return freeSpot(takenBoxes(), w, h, start, start.x + Math.max(600, (el?.clientWidth ?? 1000) - w - 24));
  }

  function addText() {
    const at = visibleSpot();
    const card: BoardCard = { id: newId(), type: "text", text: "", x: at.x, y: at.y, w: 240 };
    const next = [...cardsRef.current, card];
    setCards(next);
    save(next);
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
            const x = p.position.x / ratio - r.left + el.scrollLeft;
            const y = p.position.y / ratio - r.top + el.scrollTop;
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
    e.preventDefault();
    e.stopPropagation();
    busy.current = true;
    const sx = e.clientX;
    const sy = e.clientY;
    const start = { x: card.x, y: card.y, w: card.w ?? 240 };
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      setCards((cs) =>
        cs.map((c) =>
          c.id !== card.id
            ? c
            : mode === "move"
              ? { ...c, x: Math.max(0, Math.round(start.x + dx)), y: Math.max(0, Math.round(start.y + dy)) }
              : { ...c, w: Math.min(1000, Math.max(140, Math.round(start.w + dx))) },
        ),
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
    p.key === OVERVIEW_KEY ? !hasOverview(project.body) : p.key === DOCS_KEY ? !parts.docs : !haveSections.has(p.key),
  );

  const width = Math.max(2400, ...cards.map((c) => c.x + (c.w ?? 240) + 400));
  const height = Math.max(1600, ...cards.map((c) => c.y + 900));

  return (
    <div className="board-wrap">
      <div className="board-bar">
        <button onClick={addText}>+ Text</button>
        <button onClick={async () => addFiles(await store.storage.pickFiles())}>+ Pictures, videos & files</button>
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
          <button onClick={() => go({ view: "item", id: project.id, page: "details" })}>Details</button>
          <button onClick={() => store.storage.reveal(dir)}>Show in Finder</button>
        </span>
      </div>
      {store.storage.kind === "mac" && (
        <p className="muted small board-hint">Drag pictures, videos or files from Finder onto the Board. They're moved into this project's folder.</p>
      )}

      <div className={`board ${dropping ? "dropping" : ""}`} ref={boardEl}>
        <div className="board-canvas" style={{ width, height }}>
          {cards.map((c) => {
            const style = { left: c.x, top: c.y, width: c.w ?? 240 };
            if (c.type === "page") {
              const p = pages.find((pp) => pp.key === c.page)!;
              return (
                <div
                  key={c.id}
                  data-card={c.id}
                  className="bcard bcard-page"
                  style={style}
                  onPointerDown={(e) => startDrag(e, c, "move", () => go(p.open))}
                  title="Click to open · drag to move"
                >
                  <div className="bcard-page-title">📄 {p.title}</div>
                  <div className="muted small">{snippet(p.body) || "Empty"}</div>
                  <span className="bcard-resize" onPointerDown={(e) => startDrag(e, c, "resize")} />
                </div>
              );
            }
            return (
              <div key={c.id} data-card={c.id} className={`bcard bcard-type-${c.type}`} style={style}>
                <div className="bcard-grip" onPointerDown={(e) => startDrag(e, c, "move")} title="Drag to move">
                  <span className="bcard-grip-label">{c.type === "file" ? c.file : "Text"}</span>
                  <button
                    className="bcard-x"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => remove(c)}
                    title={c.type === "file" ? "Move to trash" : "Delete"}
                  >
                    ×
                  </button>
                </div>
                {c.type === "text" ? (
                  <AutoText
                    value={c.text ?? ""}
                    onChange={(text) => saveSoon(cardsRef.current.map((x) => (x.id === c.id ? { ...x, text } : x)))}
                  />
                ) : (
                  <FileBody path={join(dir, c.file ?? "")} name={c.file ?? ""} />
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
      placeholder="Type here…"
      autoFocus={!value}
      onChange={(e) => onChange(e.target.value)}
      rows={2}
    />
  );
}

function FileBody({ path, name }: { path: string; name: string }) {
  const store = useStore();
  const kind = fileKind(name);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (kind !== "other") store.storage.fileUrl(path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [path, kind, store.storage]);

  if (kind === "image" && url) {
    return <img className="bcard-media" src={url} alt={name} draggable={false} onDoubleClick={() => store.storage.open(path)} title="Double-click to open" />;
  }
  if (kind === "video" && url) {
    return <video className="bcard-media" src={url} controls preload="metadata" />;
  }
  return (
    <button className="bcard-file" onClick={() => store.storage.open(path)} title="Open">
      <span className="bcard-file-icon">{kind === "image" ? "🖼️" : kind === "video" ? "🎬" : "📎"}</span>
      <span>{name}</span>
    </button>
  );
}
