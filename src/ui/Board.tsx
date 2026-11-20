// A project's artboard, like a Figma board. Text cards and pictures and videos sit
// wherever you drag them; the project's pages (Overview, Market Research…) and other
// files are small desktop-style icons: click one to select it, double-click to open it.
// The sidebar lists the same things (see ProjectView). Files dropped on the artboard are
// moved into the project's folder; the layout is saved in the project file (its `board:` list).

import { useEffect, useRef, useState } from "react";
import type { BoardCard, Item } from "../core/types";
import type { LifeIndex } from "../core/index";
import { dirName, extName, join } from "../core/paths";
import { ALL_PARTS, DOCS_KEY, OVERVIEW_KEY, VENTURE_PART_KEYS, hasOverview } from "../core/projects";
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

export interface PageInfo {
  key: string;
  title: string;
  open: Route;
}

/** The project's pages, in order: Overview (when it has one), its sections, then Documentation. */
export function projectPages(index: LifeIndex, project: Item): PageInfo[] {
  const parts = index.partsOf(project);
  const pages: PageInfo[] = [];
  if (hasOverview(project.body)) pages.push({ key: OVERVIEW_KEY, title: "Overview", open: { view: "item", id: project.id, page: "details" } });
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
    const taken: Box[] = out.map((c) => ({ x: c.x, y: c.y, w: c.w ?? 240, h: guessHeight(c) }));
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
        <button onClick={() => setNaming(true)}>+ Markdown page</button>
        <button onClick={async () => addFiles(await store.storage.pickFiles())}>+ Pictures, videos, notes & files</button>
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

      <div className={`board ${dropping ? "dropping" : ""}`} ref={boardEl}>
        <div
          className="board-canvas"
          style={{ width, height }}
          onPointerDown={(e) => e.target === e.currentTarget && setSelected("")}
        >
          {cards.map((c) => {
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
                  onPointerDown={(e) => startDrag(e, c, "move", () => clickIcon(key, open))}
                  title="Double-click to open · drag to move"
                >
                  <div className="bicon-img">{kind === "page" ? "📄" : kind === "markdown" ? "📝" : "📎"}</div>
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
                className={`bcard bcard-type-${c.type} ${isSel ? "selected" : ""}`}
                style={style}
                onPointerDownCapture={() => setSelected(key)}
              >
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
      placeholder="Type here…"
      autoFocus={!value}
      onChange={(e) => onChange(e.target.value)}
      rows={2}
    />
  );
}

/** A picture or video card on the artboard. */
function FileBody({ path, name }: { path: string; name: string }) {
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
    return <img className="bcard-media" src={url} alt={name} draggable={false} onDoubleClick={() => store.storage.open(path)} title="Double-click to open" />;
  }
  if (kind === "video" && url) {
    return <video className="bcard-media" src={url} controls preload="metadata" />;
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
