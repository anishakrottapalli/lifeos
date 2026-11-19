// The Journal: one folder per day, "Journal/2026-11-11/". The day's writing is
// "2026-11-11.md"; pictures, videos and audio recordings sit beside it in the same folder.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Item } from "../core/types";
import { dirName, fileName, join } from "../core/paths";
import { kindOf, mediaLine, type MediaKind } from "../core/journal";
import { inTauri } from "../core/storage";
import { today } from "../core/paths";
import { useStore, type Route } from "./hooks";
import { renderMarkdown } from "./markdown";
import { Modal } from "./Modal";

const PASTE_EXT: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/heic": ".heic", "image/tiff": ".tiff" };
const DAY_PATH = /^Journal\/\d{4}-\d{2}-\d{2}\/[^/]+\.md$/;

/** The first line of writing, for the list (skips headings marks and picture/video/audio lines). */
function firstLine(body: string): string {
  for (const raw of body.split("\n")) {
    const l = raw.replace(/^#+\s*|^[-*]\s*|\*\*/g, "").trim();
    if (l && !/^!\[[^\]]*\]\([^)]*\)$/.test(l)) return l.length > 90 ? l.slice(0, 87) + "…" : l;
  }
  return "";
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
  const [result, setResult] = useState<{ imported: number; problems: string[] } | null>(null);
  const [importing, setImporting] = useState(false);
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

  async function importNotes() {
    const picked = await store.storage.pickFiles();
    if (!picked.length) return;
    setImporting(true);
    try {
      setResult(await store.importNoteFiles(picked));
    } catch (e) {
      setResult({ imported: 0, problems: [`Something went wrong: ${e}`] });
    }
    setImporting(false);
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-title-row">
          <h1>
            <span className="title-icon">📓</span> Journal
          </h1>
          <div className="actions">
            <button
              onClick={importNotes}
              disabled={importing}
              title="Bring in Notability entries (.note files). The date comes from each note's title."
            >
              {importing ? "Importing…" : "Import from Notability"}
            </button>
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
            const vids = content.filter((n) => kindOf(n) === "video").length;
            const recs = content.filter((n) => kindOf(n) === "audio").length;
            const bits = [
              pics ? `${pics} picture${pics === 1 ? "" : "s"}` : "",
              vids ? `${vids} video${vids === 1 ? "" : "s"}` : "",
              recs ? `${recs} recording${recs === 1 ? "" : "s"}` : "",
            ].filter(Boolean);
            return (
              <li key={d.id} className="row" onClick={() => go({ view: "item", id: d.id })}>
                <span className="row-icon">📓</span>
                <span className="row-title">
                  <span className="strong">{d.title}</span> <span className="muted small">{niceDate(d.title)}</span>
                  {firstLine(d.body) && <div className="muted small journal-preview">{firstLine(d.body)}</div>}
                </span>
                <span className="muted small">{bits.join(" · ")}</span>
              </li>
            );
          })}
        </ul>
      )}

      {result && (
        <Modal close={() => setResult(null)}>
          <h2>Import finished</h2>
          <p>
            {result.imported} entr{result.imported === 1 ? "y" : "ies"} added to the Journal.
          </p>
          {result.problems.length > 0 && (
            <>
              <p className="muted small">These need a look:</p>
              <ul className="plain">
                {result.problems.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </>
          )}
          <div className="modal-actions">
            <button className="primary" onClick={() => setResult(null)}>
              OK
            </button>
          </div>
        </Modal>
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
        <button onClick={async () => add(await store.storage.pickFiles())}>+ Add pictures, videos & audio</button>
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
            placeholder="Write about your day. Paste a copied picture, or use + Add pictures, videos & audio, to put it exactly where the cursor is."
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

/** A picture, video or audio player, shown through the window's file address. */
function Media({ path, name, kind }: { path: string; name: string; kind: Exclude<MediaKind, "other"> }) {
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
        <span className="bcard-file-icon">{kind === "image" ? "🖼️" : kind === "video" ? "🎬" : "🎙️"}</span>
        <span>{name}</span>
      </button>
    );
  }
  if (kind === "video") return <video className="journal-img" controls preload="metadata" src={url} />;
  return kind === "image" ? (
    <img className="journal-img" src={url} alt={name} draggable={false} onDoubleClick={() => store.storage.open(path)} title="Double-click to open" />
  ) : (
    <audio controls preload="metadata" src={url} />
  );
}
