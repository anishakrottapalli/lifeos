import { useState } from "react";
import type { Item } from "../core/types";
import { displayValue, timeAgo, useStore, type Route } from "./hooks";
import { Modal } from "./Modal";
import { dirName } from "../core/paths";
import { ALL_PARTS, type PartKey } from "../core/projects";

const SUGGESTED_FOLDERS = ["My Business", "My Business/Content", "My Business/Software", "My Business/Services", "Personal"];

export function ProjectsView({ go }: { go: (r: Route) => void }) {
  const store = useStore();
  const mod = store.module("projects")!;
  const [creating, setCreating] = useState(false);
  const projects = store.index.projects();
  const depth = (p: Item) => {
    let n = 0;
    let cur = store.index.parentProject(p);
    while (cur) {
      n++;
      cur = store.index.parentProject(cur);
    }
    return n;
  };

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-title-row">
          <h1>
            <span className="title-icon">{mod.icon}</span> Projects
          </h1>
          <div className="actions">
            <button onClick={() => store.storage.mkdir(mod.folder).then(() => store.storage.reveal(mod.folder))}>Show in Finder</button>
            <button className="primary" onClick={() => setCreating(true)}>
              + New project
            </button>
          </div>
        </div>
        <p className="muted">
          Each project is a folder with a Board for text, pictures, videos and files. When you make one, pick which
          extra pages it needs (Overview, the Venture sections, a Deck, a build log). Projects inside another project's
          folder show up as its sub-projects. <span className="path">LifeOS/{mod.folder}</span>
        </p>
      </header>

      {projects.length === 0 ? (
        <div className="empty">
          <p>No projects yet.</p>
          <button className="primary" onClick={() => setCreating(true)}>
            Create the first one
          </button>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Status</th>
              <th>Type</th>
              <th>Folder</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id} onClick={() => go({ view: "item", id: p.id })}>
                <td className="strong">
                  <span style={{ paddingLeft: depth(p) * 22 }}>
                    {depth(p) > 0 && <span className="muted">↳ </span>}
                    {p.title}
                  </span>
                </td>
                <td>{displayValue(p.fields["Status"])}</td>
                <td>{displayValue(p.fields["Type"])}</td>
                <td className="muted">{dirName(p.folder)}</td>
                <td className="muted small">{timeAgo(p.updated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {store.index.looseProjectNotes().length > 0 && (
        <section className="loose">
          <h2>Notes that aren't projects yet</h2>
          <p className="muted small">Plain notes in the Projects folder. Turn one into a project to give it its own folder and sections.</p>
          <ul className="list">
            {store.index.looseProjectNotes().map((n) => (
              <li key={n.id} className="row">
                <span className="row-icon">📝</span>
                <span className="row-title">{n.title}</span>
                <span className="muted small">{n.folder}</span>
                <span className="right row-actions">
                  <button onClick={() => go({ view: "item", id: n.id })}>Open</button>
                  <button
                    className="primary"
                    onClick={async () => {
                      const p = await store.convertToProject(n);
                      go({ view: "item", id: p.id });
                    }}
                  >
                    Turn into project
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {creating && (
        <NewProjectModal
          close={() => setCreating(false)}
          folders={[...new Set([...SUGGESTED_FOLDERS, ...store.index.subfolders("projects")])].sort()}
          create={async (title, folder, parts) => {
            const p = await store.createProject(title, folder, {}, parts);
            setCreating(false);
            go({ view: "item", id: p.id });
          }}
        />
      )}
    </div>
  );
}

export function NewProjectModal({
  close,
  create,
  folders,
  fixedFolder,
  heading = "New project",
}: {
  close: () => void;
  create: (title: string, folder: string, parts: PartKey[]) => void;
  folders?: string[];
  fixedFolder?: string;
  heading?: string;
}) {
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState(fixedFolder ?? "");
  const [parts, setParts] = useState<PartKey[]>([]);
  const toggle = (key: PartKey) => setParts((ps) => (ps.includes(key) ? ps.filter((k) => k !== key) : [...ps, key]));
  const allOn = parts.length === ALL_PARTS.length;
  return (
    <Modal close={close}>
      <h2>{heading}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) create(title.trim(), folder, ALL_PARTS.map((p) => p.key).filter((k) => parts.includes(k)));
        }}
      >
        <div className="form-rows">
          <label className="field">
            <span className="field-label">Name</span>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. LifeOS" />
          </label>
          {fixedFolder === undefined && (
            <label className="field">
              <span className="field-label">Inside folder (optional)</span>
              <input list="project-folders" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="e.g. My Business/Software" />
              <datalist id="project-folders">
                {(folders ?? []).map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </label>
          )}
        </div>
        <div className="field">
          <span className="field-label">What does this project need?</span>
          <p className="muted small no-margin">Every project gets a Board. Tick anything else it needs; you can add more later.</p>
          <div className="parts-list">
            <label className="check strong">
              <input type="checkbox" checked={allOn} onChange={() => setParts(allOn ? [] : ALL_PARTS.map((p) => p.key))} />
              Everything (full Venture project)
            </label>
            {ALL_PARTS.map((p) => (
              <label key={p.key} className="check indent">
                <input type="checkbox" checked={parts.includes(p.key)} onChange={() => toggle(p.key)} />
                {p.label}
              </label>
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={!title.trim()}>
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}
