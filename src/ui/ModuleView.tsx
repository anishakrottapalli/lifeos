import { useMemo, useState } from "react";
import { displayValue, timeAgo, useStore, type Route } from "./hooks";
import { FieldEditor } from "./FieldEditor";
import { Modal } from "./Modal";
import { fileName } from "../core/paths";
import { NOTION_COURSES } from "../core/notion-courses";

export function ModuleView({ moduleId, go }: { moduleId: string; go: (r: Route) => void }) {
  const store = useStore();
  const mod = store.module(moduleId);
  const [filter, setFilter] = useState("");
  const [tag, setTag] = useState("");
  const [folder, setFolder] = useState("");
  const [editingFields, setEditingFields] = useState(false);

  // In Courses, the courses inside a program are listed on the program's page, not here.
  const all = store.index.inModule(moduleId).filter((i) => store.index.isTopLevelCourse(i) || moduleId !== "courses");
  const tags = useMemo(() => [...new Set(all.flatMap((i) => i.tags))].sort(), [all]);
  const folders = store.index.subfolders(moduleId);
  const loose = store.index.unfiled(moduleId);
  const docs = store.index.docsForApp(moduleId);

  if (!mod) return <div className="page">Unknown app.</div>;

  const shown = (filter ? store.index.search(filter, moduleId) : all).filter(
    (i) => (!tag || i.tags.includes(tag)) && (!folder || i.folder === folder || i.folder.startsWith(folder + "/")),
  );
  const columns = mod.fields.slice(0, 3);
  // In Courses, a program (a folder of courses) is a row too.
  const programRows =
    moduleId === "courses" && !tag && !folder
      ? store.index.programs().filter((d) => !filter || fileName(d).toLowerCase().includes(filter.toLowerCase()))
      : [];
  const [newProgram, setNewProgram] = useState(false);
  const [progName, setProgName] = useState("");
  const [firstCourse, setFirstCourse] = useState("");
  async function createProgram() {
    if (!progName.trim() || !firstCourse.trim()) return;
    const made = await store.createProgram(progName.trim(), firstCourse.trim());
    setNewProgram(false);
    setProgName("");
    setFirstCourse("");
    go({ view: "item", id: made.id });
  }

  const toImport =
    moduleId === "courses" ? store.coursesLeftToImport(NOTION_COURSES) : 0;
  const [importing, setImporting] = useState(false);
  async function importCourses() {
    setImporting(true);
    try {
      await store.importCourses(NOTION_COURSES);
    } finally {
      setImporting(false);
    }
  }

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
            {moduleId === "courses" && toImport > 0 && (
              <button onClick={importCourses} disabled={importing} title="One-time: bring in the courses from your Notion page">
                {importing ? "Importing…" : `Import my Notion courses (${toImport})`}
              </button>
            )}
            {moduleId === "courses" && (
              <button onClick={() => setNewProgram(true)} title="A program is a folder that holds several courses, like a certificate">
                + New program
              </button>
            )}
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

      {shown.length === 0 && programRows.length === 0 ? (
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
            {programRows.map((d) => (
              <tr key={d} onClick={() => go({ view: "program", dir: d })}>
                <td className="strong">🗂 {fileName(d)}</td>
                <td className="muted" colSpan={columns.length + 1}>
                  Program · {store.index.programCourses(d).length} courses
                </td>
                <td className="muted small" />
              </tr>
            ))}
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

      {newProgram && (
        <Modal close={() => setNewProgram(false)}>
          <h2>New program</h2>
          <p className="muted small">A program is a folder that holds several courses. It needs its first course to exist.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createProgram();
            }}
          >
            <div className="form-rows">
              <label className="field">
                <span className="field-label">Program name</span>
                <input autoFocus value={progName} onChange={(e) => setProgName(e.target.value)} placeholder="e.g. UX Certificate" />
              </label>
              <label className="field">
                <span className="field-label">First course</span>
                <input value={firstCourse} onChange={(e) => setFirstCourse(e.target.value)} placeholder="e.g. Intro to UX Design" />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setNewProgram(false)}>
                Cancel
              </button>
              <button className="primary" type="submit" disabled={!progName.trim() || !firstCourse.trim()}>
                Create
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
