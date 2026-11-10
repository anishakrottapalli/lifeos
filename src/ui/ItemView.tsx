import { useEffect, useRef, useState } from "react";
import type { FieldDef, Item } from "../core/types";
import { dirName, join } from "../core/paths";
import { displayValue, timeAgo, useStore, type Route } from "./hooks";
import { LinkPicker } from "./LinkPicker";
import { renderMarkdown } from "./markdown";

const SAVE_DELAY = 700;

export function ItemView({ itemId, go }: { itemId: string; go: (r: Route) => void }) {
  const store = useStore();
  const stored = store.index.items.get(itemId);
  const [draft, setDraft] = useState<Item | undefined>(stored);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState(false);
  const [linking, setLinking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<Item | undefined>(draft);
  latest.current = draft;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  // When the file changes outside the editor (Finder, another window) and
  // there are no unsaved edits here, show the new version.
  useEffect(() => {
    if (!dirty && stored) setDraft(stored);
  }, [stored, dirty]);

  // Save anything pending when leaving the page.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      const d = latest.current;
      if (d && dirtyRef.current) store.saveItem(d, { rename: true });
    },
    [store],
  );

  if (!draft) {
    return (
      <div className="page">
        <p className="muted">This item isn't in the folder anymore.</p>
        <button onClick={() => go({ view: "home" })}>Back to Home</button>
      </div>
    );
  }
  const mod = store.module(draft.module)!;

  async function persist(item: Item, rename: boolean) {
    clearTimeout(timer.current);
    setStatus("Saving…");
    try {
      const saved = await store.saveItem(item, { rename });
      setDirty(false);
      setStatus("Saved");
      if (saved.id !== itemId) go({ view: "item", id: saved.id });
      else setDraft(saved);
    } catch (e) {
      setStatus(`Couldn't save: ${e}`);
    }
  }

  function change(patch: Partial<Item>, opts: { rename?: boolean; now?: boolean } = {}) {
    const next = { ...latest.current!, ...patch };
    setDraft(next);
    setDirty(true);
    setStatus("Editing…");
    clearTimeout(timer.current);
    if (opts.now) persist(next, opts.rename ?? false);
    else timer.current = setTimeout(() => persist(latest.current!, false), SAVE_DELAY);
  }

  const setField = (key: string, value: unknown) => change({ fields: { ...draft.fields, [key]: value } });
  const otherKeys = Object.keys(draft.fields).filter((k) => !mod.fields.some((f) => f.key === k));
  const backlinks = store.index.backlinks(draft.id);
  const folders = store.index.subfolders(draft.module);
  const dir = dirName(draft.path);

  return (
    <div className="page item-page">
      <div className="crumbs">
        <button className="link" onClick={() => go({ view: "module", id: mod.id })}>
          {mod.icon} {mod.name}
        </button>
        {draft.folder && <span className="muted"> / {draft.folder}</span>}
        <span className="status muted small">{status}</span>
      </div>

      <input
        className="title-input"
        value={draft.title}
        placeholder="Title"
        onChange={(e) => change({ title: e.target.value })}
        onBlur={() => dirtyRef.current && persist(latest.current!, true)}
        autoFocus={draft.title === "Untitled"}
        onFocus={(e) => draft.title === "Untitled" && e.target.select()}
      />

      <div className="meta-row">
        <label className="meta">
          <span className="muted small">Folder</span>
          <input
            list="folder-options"
            value={draft.folder}
            placeholder="(top of the app)"
            onChange={(e) => change({ folder: e.target.value })}
            onBlur={() => dirtyRef.current && persist(latest.current!, true)}
          />
          <datalist id="folder-options">
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </label>
        <div className="actions">
          <button onClick={() => store.storage.reveal(draft.path)}>Show in Finder</button>
          <button onClick={() => store.storage.open(draft.path)}>Open note file</button>
          <button
            className="danger"
            onClick={async () => {
              if (!confirm(`Move "${draft.title}" to LifeOS's trash? (It's kept in LifeOS/.trash.)`)) return;
              clearTimeout(timer.current);
              setDirty(false);
              dirtyRef.current = false;
              await store.deleteItem(draft);
              go({ view: "module", id: mod.id });
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {mod.fields.length > 0 && (
        <section className="fields">
          {mod.fields.map((f) => (
            <FieldInput key={f.key} def={f} value={draft.fields[f.key]} onChange={(v) => setField(f.key, v)} />
          ))}
        </section>
      )}

      <TagInput tags={draft.tags} all={store.index.allTags()} onChange={(tags) => change({ tags }, { now: true })} />

      <section className="body-section">
        <div className="section-head">
          <h3>Notes</h3>
          <button className="small-button" onClick={() => setPreview((p) => !p)}>
            {preview ? "Edit" : "Preview"}
          </button>
        </div>
        {preview ? (
          <div className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.body || "*Nothing written yet.*") }} />
        ) : (
          <textarea
            className="body-input"
            value={draft.body}
            placeholder="Write anything. Markdown works: # headings, - lists, **bold**."
            onChange={(e) => change({ body: e.target.value })}
          />
        )}
      </section>

      <section>
        <div className="section-head">
          <h3>Files</h3>
          <button
            className="small-button"
            onClick={async () => {
              const picked = await store.storage.pickFiles();
              if (!picked.length) return;
              if (dirty) await persist(latest.current!, false);
              const saved = await store.addFiles(store.index.items.get(draft.id) ?? latest.current!, picked);
              setDraft(saved);
              setStatus("Files moved into LifeOS");
            }}
          >
            + Add files
          </button>
        </div>
        {draft.files.length === 0 ? (
          <p className="muted small">No files. Added files are moved (not copied) into this item's folder.</p>
        ) : (
          <ul className="list">
            {draft.files.map((f) => (
              <li key={f} className="row">
                <span className="row-icon">📄</span>
                <span className="row-title">{f}</span>
                <span className="right row-actions">
                  <button onClick={() => store.storage.open(join(dir, f))}>Open</button>
                  <button onClick={() => store.storage.reveal(join(dir, f))}>Show</button>
                  <button
                    title="Detach (the file stays in the folder)"
                    onClick={async () => setDraft(await store.removeFile(latest.current!, f))}
                  >
                    Detach
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="section-head">
          <h3>Links</h3>
          <button className="small-button" onClick={() => setLinking(true)}>
            + Add link
          </button>
        </div>
        {draft.links.length === 0 ? (
          <p className="muted small">Link this to anything in any app (a project, a person, a source…).</p>
        ) : (
          <ul className="list">
            {draft.links.map((l, i) => {
              const target = store.index.items.get(l.to);
              const tm = target && store.module(target.module);
              return (
                <li key={i} className="row">
                  <span className="pill">{l.kind}</span>
                  {target ? (
                    <button className="link row-title" onClick={() => go({ view: "item", id: target.id })}>
                      {tm?.icon} {target.title}
                    </button>
                  ) : (
                    <span className="row-title muted">Missing item ({l.to})</span>
                  )}
                  <span className="muted small">{tm?.name}</span>
                  <span className="right row-actions">
                    <button title="Remove link" onClick={async () => setDraft(await store.removeLink(latest.current!, i))}>
                      ✕
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h3>Linked from</h3>
        {backlinks.length === 0 ? (
          <p className="muted small">Nothing links here yet.</p>
        ) : (
          <ul className="list">
            {backlinks.map((b) => {
              const bm = store.module(b.item.module);
              return (
                <li key={b.item.id + b.kind} className="row" onClick={() => go({ view: "item", id: b.item.id })}>
                  <span className="pill">{b.kind}</span>
                  <span className="row-title">
                    {bm?.icon} {b.item.title}
                  </span>
                  <span className="muted small">{bm?.name}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {otherKeys.length > 0 && (
        <section>
          <h3>Other fields</h3>
          <p className="muted small">Saved in the file but not part of this app's field list.</p>
          <div className="fields">
            {otherKeys.map((k) => (
              <label key={k} className="field">
                <span className="field-label">{k}</span>
                <input value={displayValue(draft.fields[k])} onChange={(e) => setField(k, e.target.value)} />
              </label>
            ))}
          </div>
        </section>
      )}

      <footer className="item-foot muted small">
        <span>
          File: <code>LifeOS/{draft.path}</code>
        </span>
        <span>Created {draft.created || "—"}</span>
        <span>Updated {timeAgo(draft.updated)}</span>
      </footer>

      {linking && (
        <LinkPicker
          from={draft}
          kinds={mod.linkKinds ?? ["related"]}
          close={() => setLinking(false)}
          pick={async (target, kind) => {
            setLinking(false);
            if (dirty) await persist(latest.current!, false);
            const saved = await store.addLink(store.index.items.get(draft.id) ?? latest.current!, target, kind);
            setDraft(saved);
          }}
        />
      )}
    </div>
  );
}

function FieldInput({ def, value, onChange }: { def: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const label = <span className="field-label">{def.key}</span>;
  switch (def.type) {
    case "longtext":
      return (
        <label className="field wide">
          {label}
          <textarea rows={3} value={displayValue(value)} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
    case "number":
      return (
        <label className="field">
          {label}
          <input
            type="number"
            value={value === undefined || value === null || value === "" ? "" : String(value)}
            onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          />
        </label>
      );
    case "date":
      return (
        <label className="field">
          {label}
          <input type="date" value={displayValue(value).slice(0, 10)} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
    case "checkbox":
      return (
        <label className="field check">
          <input type="checkbox" checked={value === true || value === "true"} onChange={(e) => onChange(e.target.checked)} />
          {label}
        </label>
      );
    case "select":
      return (
        <label className="field">
          {label}
          <select value={displayValue(value)} onChange={(e) => onChange(e.target.value)}>
            <option value="">—</option>
            {(def.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
            {value && !(def.options ?? []).includes(String(value)) ? <option value={String(value)}>{String(value)}</option> : null}
          </select>
        </label>
      );
    case "multiselect": {
      const list = Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
      return (
        <div className="field wide">
          {label}
          <div className="chips">
            {(def.options ?? []).map((o) => (
              <button
                key={o}
                className={`chip ${list.includes(o) ? "on" : ""}`}
                onClick={() => onChange(list.includes(o) ? list.filter((x) => x !== o) : [...list, o])}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      );
    }
    case "url":
      return (
        <label className="field">
          {label}
          <span className="url-row">
            <input type="url" value={displayValue(value)} placeholder="https://" onChange={(e) => onChange(e.target.value)} />
            {value ? (
              <a href={String(value)} target="_blank" rel="noreferrer" title="Open link">
                ↗
              </a>
            ) : null}
          </span>
        </label>
      );
    default:
      return (
        <label className="field">
          {label}
          <input value={displayValue(value)} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
  }
}

function TagInput({ tags, all, onChange }: { tags: string[]; all: string[]; onChange: (t: string[]) => void }) {
  const [text, setText] = useState("");
  const add = (t: string) => {
    const clean = t.trim().replace(/^#/, "");
    if (clean && !tags.includes(clean)) onChange([...tags, clean]);
    setText("");
  };
  const suggestions = text ? all.filter((t) => t.toLowerCase().startsWith(text.toLowerCase()) && !tags.includes(t)).slice(0, 6) : [];
  return (
    <section className="tags">
      <span className="field-label">Tags</span>
      <div className="chips">
        {tags.map((t) => (
          <span key={t} className="chip on">
            #{t}
            <button className="chip-x" onClick={() => onChange(tags.filter((x) => x !== t))}>
              ×
            </button>
          </span>
        ))}
        <input
          className="tag-input"
          value={text}
          placeholder="Add tag"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(text);
            }
          }}
          onBlur={() => text && add(text)}
        />
        {suggestions.map((s) => (
          <button key={s} className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => add(s)}>
            #{s}
          </button>
        ))}
      </div>
    </section>
  );
}
