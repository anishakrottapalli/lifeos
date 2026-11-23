// The Journal: one folder per day, "Journal/2026-11-11/". The day's writing is
// "2026-11-11.md"; pictures, videos and audio recordings sit beside it in the same folder.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Item } from "../core/types";
import { dirName, fileName, join } from "../core/paths";
import { kindOf, mediaLine } from "../core/journal";
import { inTauri } from "../core/storage";
import { today } from "../core/paths";
import { useStore, type Route } from "./hooks";
import { renderMarkdown } from "./markdown";
import { Modal } from "./Modal";

const PASTE_EXT: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/heic": ".heic", "image/tiff": ".tiff" };
const DAY_PATH = /^Journal\/[^/.][^/]*\/[^/]+\.md$/;
const IS_DATE = /^\d{4}-\d{2}-\d{2}$/;

function niceDate(date: string): string {
  const d = new Date(date + "T12:00:00");
  return isNaN(d.getTime()) ? date : d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

/** Everything in a day's folder except its text page. */
function contentOf(store: ReturnType<typeof useStore>, day: Item) {
  const dir = dirName(day.path);
  return store.index.entries
    .filter((e) => dirName(e.path) === dir && e.path !== day.path && !fileName(e.path).startsWith("."))
    .map((e) => fileName(e.path))
    .sort((a, b) => a.localeCompare(b));
}

export function JournalList({ go }: { go: (r: Route) => void }) {
  const store = useStore();
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState(today());
  const [error, setError] = useState("");
  const days = useMemo(
    () =>
      store.index
        .inModule("journal")
        .filter((i) => DAY_PATH.test(i.path))
        // Days newest first, then entries named by a title (A to Z).
        .sort((a, b) => Number(IS_DATE.test(b.title)) - Number(IS_DATE.test(a.title)) || (IS_DATE.test(a.title) ? b.title.localeCompare(a.title) : a.title.localeCompare(b.title))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.index.items, store.version],
  );

  async function create() {
    try {
      const day = await store.openJournalDay(date);
      setAdding(false);
      go({ view: "item", id: day.id });
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-title-row">
          <h1>
            <span className="title-icon">📓</span> Journal
          </h1>
          <div className="actions">
            <button onClick={() => store.storage.mkdir("Journal").then(() => store.storage.reveal("Journal"))}>Show in Finder</button>
            <button className="primary" onClick={() => setAdding(true)}>
              New day
            </button>
          </div>
        </div>
      </header>

      {days.length === 0 ? (
        <div className="empty">
          <p>No days yet.</p>
          <button className="primary" onClick={() => setAdding(true)}>
            Add the first day
          </button>
        </div>
      ) : (
        <ul className="list day-list">
          {days.map((d) => {
            const hasFiles = contentOf(store, d).length > 0;
            return (
              <li key={d.id} className="row" onClick={() => go({ view: "item", id: d.id })}>
                <span className="row-title strong">{IS_DATE.test(d.title) ? niceDate(d.title) : d.title}</span>
                {hasFiles && (
                  <svg className="clip" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Has attachments">
                    <path d="M20 11.5l-7.8 7.8a5 5 0 01-7.1-7.1l8.5-8.5a3.4 3.4 0 014.8 4.8l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.8-7.8" />
                  </svg>
                )}
                <span className="muted">›</span>
              </li>
            );
          })}
        </ul>
      )}

      {adding && (
        <Modal close={() => setAdding(false)}>
          <h2>New day</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <label className="field">
              <span className="field-label">Date</span>
              <input type="date" autoFocus value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            {error && <p className="error small">{error}</p>}
            <div className="modal-actions">
              <button type="button" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button className="primary" type="submit" disabled={!date}>
                Open day
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export function JournalDay({ itemId, go }: { itemId: string; go: (r: Route) => void }) {
  const store = useStore();
  const day = store.index.items.get(itemId);
  const [text, setText] = useState(day?.body ?? "");
  const [status, setStatus] = useState("");
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const textRef = useRef(text);
  textRef.current = text;
  // The writing is always editable: just type. Pictures, videos and audio go in at the cursor with the Insert buttons.
  const editing = true;
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});

  // Show changes made outside LifeOS, unless you're in the middle of typing.
  useEffect(() => {
    if (!dirty.current && day) setText(day.body);
  }, [day?.body]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    clearTimeout(timer.current);
    const fresh = store.index.items.get(itemId);
    if (!fresh || !dirty.current) return;
    dirty.current = false;
    setStatus("Saving…");
    try {
      await store.saveItem({ ...fresh, body: textRef.current });
      setStatus("Saved");
    } catch (e) {
      dirty.current = true;
      setStatus(`Couldn't save: ${e}`);
    }
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => () => void saveRef.current(), []);

  /** Put files in the text: where the cursor is while you're editing, otherwise at the end. */
  async function place(names: string[]) {
    const block = names.map((n) => mediaLine(n)).join("\n\n");
    const cur = textRef.current;
    const area = areaRef.current;
    const at = editing && area ? area.selectionStart : cur.length;
    const before = cur.slice(0, at).replace(/\s+$/, "");
    const after = cur.slice(at).replace(/^\s+/, "");
    const next = `${before}${before ? "\n\n" : ""}${block}${after ? "\n\n" : "\n"}${after}`;
    textRef.current = next;
    setText(next);
    dirty.current = true;
    await saveRef.current();
  }

  async function add(paths: string[]) {
    if (!day || !paths.length) return;
    await save();
    setStatus("Adding files…");
    try {
      const before = new Set(contentOf(store, day));
      await store.addJournalFiles(store.index.items.get(itemId) ?? day, paths);
      const fresh = store.index.items.get(itemId) ?? day;
      const added = contentOf(store, fresh).filter((n) => !before.has(n) && kindOf(n) !== "other");
      if (added.length) await place(added);
      setStatus(`Moved ${paths.length} file${paths.length === 1 ? "" : "s"} into the day's folder`);
    } catch (e) {
      setStatus(`Couldn't add: ${e}`);
    }
  }
  const addRef = useRef(add);
  addRef.current = add;

  // Files dragged in from Finder (the Mac app only).
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
            addRef.current(p.paths);
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

  const names = day ? contentOf(store, day).filter((n) => kindOf(n) !== "other") : [];
  const namesKey = names.join("|");
  useEffect(() => {
    let alive = true;
    const base = day ? dirName(day.path) : "";
    Promise.all(names.map(async (n) => [n, await store.storage.fileUrl(join(base, n))] as const)).then((pairs) => {
      if (!alive) return;
      const next: Record<string, string> = {};
      for (const [n, u] of pairs) if (u) next[n] = u;
      setUrls(next);
    });
    return () => {
      alive = false;
    };
  }, [namesKey, day?.path, store.storage]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!day) {
    return (
      <div className="page">
        <p className="muted">This day isn't in the folder anymore.</p>
        <button onClick={() => go({ view: "module", id: "journal" })}>Back to Journal</button>
      </div>
    );
  }
  const dir = dirName(day.path);
  return (
    <div className={`page item-page ${dropping ? "dropping" : ""}`}>
      <div className="crumbs">
        <button className="link" onClick={() => go({ view: "module", id: "journal" })}>
          Journal
        </button>
        <span className="status muted small">{status}</span>
      </div>
      <h1 className="day-title">{IS_DATE.test(day.title) ? niceDate(day.title) : day.title}</h1>

      <div className="actions">
        <button onClick={() => store.storage.reveal(dir)}>Show in Finder</button>
        <button
          className="danger"
          onClick={async () => {
            if (!window.confirm(`Move the whole day ${day.title} to LifeOS's trash? (It's kept in LifeOS/.trash.)`)) return;
            clearTimeout(timer.current);
            dirty.current = false;
            await store.deleteJournalDay(day);
            go({ view: "module", id: "journal" });
          }}
        >
          Delete day
        </button>
      </div>
      {store.storage.kind === "mac" && <p className="muted small">Drag pictures and recordings from Finder onto this page. They're moved into the day's folder.</p>}

      <section className="body-section day-body">
        <div className="insert-bar" role="toolbar" aria-label="Insert">
          <span className="eyebrow">Insert</span>
          {INSERTS.map((k) => (
            <button key={k.label} onClick={async () => add(await store.storage.pickFiles(k.only))}>
              {k.label}
            </button>
          ))}
        </div>
        {editing ? (
          <textarea
            ref={areaRef}
            className="body-input"
            value={text}
            autoFocus
            placeholder="Just type. Use Insert to put a picture, video or recording right where the cursor is, then keep typing."
            onChange={(e) => {
              setText(e.target.value);
              dirty.current = true;
              setStatus("Editing…");
              clearTimeout(timer.current);
              timer.current = setTimeout(() => saveRef.current(), 700);
            }}
            onBlur={() => void save()}
            onPaste={async (e) => {
              // A copied picture becomes its own file, placed at the cursor. Copied words paste as normal.
              const pics = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
              if (!pics.length || e.clipboardData.getData("text/plain").trim()) return;
              e.preventDefault();
              setStatus("Saving picture…");
              try {
                const names: string[] = [];
                for (const f of pics) {
                  const ext = PASTE_EXT[f.type] ?? ".png";
                  names.push(await store.addJournalPicture(store.index.items.get(itemId) ?? day, new Uint8Array(await f.arrayBuffer()), ext));
                }
                await place(names);
                setStatus(`Saved ${names.length === 1 ? "the picture" : `${names.length} pictures`} in the day's folder`);
              } catch (err) {
                setStatus(`Couldn't save the picture: ${err}`);
              }
            }}
          />
        ) : null}
        {/\!\[[^\]]*\]\(/.test(text) && (
          <div className="markdown day-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(text, (n) => urls[n]) }} />
        )}
      </section>

    </div>
  );
}

const INSERTS: { label: string; only: { name: string; extensions: string[] } }[] = [
  { label: "Picture", only: { name: "Pictures", extensions: ["png", "jpg", "jpeg", "gif", "webp", "heic", "tiff"] } },
  { label: "Video", only: { name: "Videos", extensions: ["mp4", "mov", "m4v", "webm"] } },
  { label: "Audio", only: { name: "Audio", extensions: ["m4a", "mp3", "wav", "aac", "aiff", "caf"] } },
];
