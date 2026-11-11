import { useMemo, useState } from "react";
import { displayValue, timeAgo, useStore, type Route } from "./hooks";
import { FieldEditor } from "./FieldEditor";
import { fileName } from "../core/paths";

export function ModuleView({ moduleId, go }: { moduleId: string; go: (r: Route) => void }) {
  const store = useStore();
  const mod = store.module(moduleId);
  const [filter, setFilter] = useState("");
  const [tag, setTag] = useState("");
  const [folder, setFolder] = useState("");
  const [editingFields, setEditingFields] = useState(false);

  const all = store.index.inModule(moduleId);
  const tags = useMemo(() => [...new Set(all.flatMap((i) => i.tags))].sort(), [all]);
  const folders = store.index.subfolders(moduleId);
  const loose = store.index.unfiled(moduleId);
  const docs = store.index.docsForApp(moduleId);

  if (!mod) return <div className="page">Unknown app.</div>;

  const shown = (filter ? store.index.search(filter, moduleId) : all).filter(
    (i) => (!tag || i.tags.includes(tag)) && (!folder || i.folder === folder || i.folder.startsWith(folder + "/")),
  );
  const columns = mod.fields.slice(0, 3);

  async function add() {
    const item = await store.createItem(moduleId, "Untitled", folder);
    go({ view: "item", id: item.id });
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-title-row">
          <h1>
            <span className="title-icon">{mod.icon}</span> {mod.name}
          </h1>
          <div className="actions">
            <button onClick={() => store.storage.mkdir(mod.folder).then(() => store.storage.reveal(mod.folder))}>
              Show in Finder
            </button>
            {docs && <button onClick={() => go({ view: "item", id: docs.id })}>Docs</button>}
            <button onClick={() => setEditingFields(true)}>Fields</button>
            <button className="primary" onClick={add}>
              + New
            </button>
          </div>
        </div>
        <p className="muted">
          {mod.description} <span className="path">LifeOS/{mod.folder}</span>
          {mod.storage === "anywhere" && <span className="pill">☁ Anywhere</span>}
          {mod.locked && <span className="pill">🔒 Locked</span>}
        </p>
        {mod.note && <div className="note">{mod.note}</div>}
      </header>

      <div className="toolbar">
        <input className="grow" placeholder={`Search ${mod.name}…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
        {folders.length > 0 && (
          <select value={folder} onChange={(e) => setFolder(e.target.value)}>
            <option value="">All folders</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        )}
      </div>
      {tags.length > 0 && (
        <div className="chips">
          {tags.map((t) => (
            <button key={t} className={`chip ${tag === t ? "on" : ""}`} onClick={() => setTag(tag === t ? "" : t)}>
              #{t}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="empty">
          <p>{all.length ? "Nothing matches." : `No items in ${mod.name} yet.`}</p>
          {!all.length && (
            <button className="primary" onClick={add}>
              Add the first one
            </button>
          )}
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              {columns.map((c) => (
                <th key={c.key}>{c.key}</th>
              ))}
              <th>Folder</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.id} onClick={() => go({ view: "item", id: i.id })}>
                <td className="strong">
                  {i.title}
                  {i.tags.length > 0 && <span className="muted small"> {i.tags.map((t) => `#${t}`).join(" ")}</span>}
                </td>
                {columns.map((c) => (
                  <td key={c.key}>{displayValue(i.fields[c.key])}</td>
                ))}
                <td className="muted">{i.folder}</td>
                <td className="muted small">{timeAgo(i.updated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {loose.length > 0 && (
        <section className="loose">
          <h2>Loose files</h2>
          <p className="muted small">Files in this folder that aren't attached to an item (for example, dropped in through Finder).</p>
          <ul className="list">
            {loose.map((e) => (
              <li key={e.path} className="row">
                <span className="row-icon">📄</span>
                <span className="row-title">{fileName(e.path)}</span>
                <span className="muted small">{e.path.slice(mod.folder.length + 1)}</span>
                <span className="right row-actions">
                  <button onClick={() => store.storage.open(e.path)}>Open</button>
                  <button
                    className="primary"
                    onClick={async () => {
                      const item = await store.fileLooseFile(moduleId, e.path);
                      go({ view: "item", id: item.id });
                    }}
                  >
                    Make item
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editingFields && <FieldEditor moduleId={moduleId} close={() => setEditingFields(false)} />}
    </div>
  );
}
