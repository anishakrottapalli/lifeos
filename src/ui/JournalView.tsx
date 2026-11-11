// The Journal: one folder per day, "Journal/2026-11-11/". The day's writing is
// "2026-11-11.lifeos": the text with each picture and recording in place, plus a
// copy of them. The same pictures and recordings are also saved as separate files beside it.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Item } from "../core/types";
import { dirName, extName, fileName, join } from "../core/paths";
import { inTauri } from "../core/storage";
import { today } from "../core/paths";
import { useStore, type Route } from "./hooks";
import { renderMarkdown } from "./markdown";
import { Modal } from "./Modal";

const IMAGE = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".heic"];
const AUDIO = [".m4a", ".mp3", ".wav", ".aac", ".aiff", ".caf", ".ogg", ".flac"];
const DAY_PATH = /^Journal\/\d{4}-\d{2}-\d{2}\/[^/]+\.lifeos$/;

function kindOf(name: string): "image" | "audio" | "other" {
  const e = extName(name).toLowerCase();
  return IMAGE.includes(e) ? "image" : AUDIO.includes(e) ? "audio" : "other";
}

function niceDate(date: string): string {
  const d = new Date(date + "T12:00:00");
  return isNaN(d.getTime()) ? date : d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

/** Everything in a day's folder except its text page. */
function contentOf(store: ReturnType<typeof useStore>, day: Item) {
  const dir = dirName(day.path);
  return store.index.entries
    .filter((e) => dirName(e.path) === dir && e.path !== day.path && !fileName(e.path).startsWith("."))
    .map((e) => fileName(e.path))
    .sort((a, b) => a.localeCompare(b));
}

/** The line that puts a file in the text: ![](photo.jpg). Spaces and brackets are escaped so it stays one piece. */
function mediaLine(name: string): string {
  return `![](${encodeURIComponent(name).replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
}

/** Names of the files a text already shows. */
function placedNames(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    try {
      out.add(decodeURIComponent(m[1]));
    } catch {
      out.add(m[1]);
    }
  }
  return out;
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
        .sort((a, b) => b.title.localeCompare(a.title)),
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
              + New day
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
        <ul className="list">
          {days.map((d) => {
            const content = contentOf(store, d);
            const pics = content.filter((n) => kindOf(n) === "image").length;
            const recs = content.filter((n) => kindOf(n) === "audio").length;
            const bits = [
              pics ? `${pics} picture${pics === 1 ? "" : "s"}` : "",
              recs ? `${recs} recording${recs === 1 ? "" : "s"}` : "",
            ].filter(Boolean);
            return (
              <li key={d.id} className="row" onClick={() => go({ view: "item", id: d.id })}>
                <span className="row-icon">📓</span>
                <span className="row-title">
                  <span className="strong">{d.title}</span> <span className="muted small">{niceDate(d.title)}</span>
                </span>
                <span className="muted small">{bits.join(" · ")}</span>
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
  const [editing, setEditing] = useState(() => !(day?.body ?? "").trim());
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
  async function place(names: string[], embed = true) {
    if (embed && day) await store.embedJournalFiles(store.index.items.get(itemId) ?? day, names);
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
      if (added.length) await place(added, false);
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
    const inside = day?.attachments ?? {};
    Promise.all(names.map(async (n) => [n, inside[n] ?? (await store.storage.fileUrl(join(base, n)))] as const)).then((pairs) => {
      if (!alive) return;
      const next: Record<string, string> = {};
      for (const [n, u] of pairs) if (u) next[n] = u;
      setUrls(next);
    });
    return () => {
      alive = false;
    };
  }, [namesKey, day?.path, day?.attachments, store.storage]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!day) {
    return (
      <div className="page">
        <p className="muted">This day isn't in the folder anymore.</p>
        <button onClick={() => go({ view: "module", id: "journal" })}>Back to Journal</button>
      </div>
    );
  }
  const dir = dirName(day.path);
  const content = contentOf(store, day);
  const placed = placedNames(text);
  const unplaced = content.filter((n) => !placed.has(n));

  async function remove(name: string) {
    if (!window.confirm(`Move "${name}" to the LifeOS trash? (You can get it back from the hidden .trash folder.)`)) return;
    await store.removeJournalFile(day!, name);
  }

  return (
    <div className={`page item-page ${dropping ? "dropping" : ""}`}>
      <div className="crumbs">
        <button className="link" onClick={() => go({ view: "module", id: "journal" })}>
          📓 Journal
        </button>
        <span className="status muted small">{status}</span>
      </div>
      <h1>{day.title}</h1>
      <p className="muted">{niceDate(day.title)}</p>

      <div className="actions">
        <button onClick={async () => add(await store.storage.pickFiles())}>+ Add pictures & audio</button>
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

      <section className="body-section">
        <div className="section-head">
          <h3>Writing</h3>
          <span className="row-actions">
            <button className="small-button" onClick={() => setEditing((e) => !e)}>
              {editing ? "Done" : "Edit"}
            </button>
          </span>
        </div>
        {editing ? (
          <textarea
            ref={areaRef}
            className="body-input"
            value={text}
            autoFocus
            placeholder="Write about your day. Use + Add pictures & audio to put them exactly where the cursor is."
            onChange={(e) => {
              setText(e.target.value);
              dirty.current = true;
              setStatus("Editing…");
              clearTimeout(timer.current);
              timer.current = setTimeout(() => saveRef.current(), 700);
            }}
            onBlur={() => void save()}
          />
        ) : (
          <div
            className="markdown"
            onDoubleClick={() => setEditing(true)}
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(text || "*Nothing written yet. Double-click to write.*", (n) => urls[n]),
            }}
          />
        )}
      </section>

      {unplaced.length > 0 && (
        <section>
          <h3>In this day's folder, not in the text yet</h3>
          <ul className="list">
            {unplaced.map((n) => {
              const kind = kindOf(n);
              return (
                <li key={n} className="row journal-rec">
                  <span className="row-title">{n}</span>
                  {kind !== "other" && <Media path={join(dir, n)} name={n} kind={kind} />}
                  <span className="right row-actions">
                    {kind !== "other" ? (
                      <button onClick={() => place([n])}>Put in text</button>
                    ) : (
                      <button onClick={() => store.storage.open(join(dir, n))}>Open</button>
                    )}
                    <button onClick={() => store.storage.reveal(join(dir, n))}>Show</button>
                    <button onClick={() => remove(n)}>Remove</button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/** A picture or an audio player, shown through the window's file address. */
function Media({ path, name, kind }: { path: string; name: string; kind: "image" | "audio" }) {
  const store = useStore();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    store.storage.fileUrl(path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [path, store.storage]);
  if (!url) {
    return (
      <button className="bcard-file" onClick={() => store.storage.open(path)} title="Open">
        <span className="bcard-file-icon">{kind === "image" ? "🖼️" : "🎙️"}</span>
        <span>{name}</span>
      </button>
    );
  }
  return kind === "image" ? (
    <img className="journal-img" src={url} alt={name} draggable={false} onDoubleClick={() => store.storage.open(path)} title="Double-click to open" />
  ) : (
    <audio controls preload="metadata" src={url} />
  );
}
