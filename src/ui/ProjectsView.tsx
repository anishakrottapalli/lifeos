import { useState } from "react";
import type { Item } from "../core/types";
import { displayValue, timeAgo, useStore, type Route } from "./hooks";
import { Modal } from "./Modal";
import { dirName } from "../core/paths";
import { DOCS_KEY, PROJECT_GROUPS, VENTURE_PART_KEYS, type PartKey, type ProjectGroup } from "../core/projects";

const SUGGESTED_SUBFOLDERS: Record<ProjectGroup, string[]> = { Personal: [], Venture: ["Content", "Software", "Services"] };

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
          Each project is a folder with a Board for text, documents, videos and photos. Personal projects go in
          Personal, ventures in Ventures. Add the Venture Ideation System or a build log when a project needs them.
          Projects inside another project's folder show up as its sub-projects. <span className="path">LifeOS/{mod.folder}</span>
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
          folders={store.index.subfolders("projects")}
          create={async (title, folder, parts, fields) => {
            const p = await store.createProject(title, folder, fields, parts);
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
  create: (title: string, folder: string, parts: PartKey[], fields: Record<string, unknown>) => void;
  folders?: string[];
  fixedFolder?: string;
  heading?: string;
}) {
  const [title, setTitle] = useState("");
  const [group, setGroup] = useState<ProjectGroup>("Personal");
  const [sub, setSub] = useState("");
  const [venture, setVenture] = useState(false);
  const [log, setLog] = useState(false);
  const top = PROJECT_GROUPS[group];
  const subOptions = [
    ...new Set([
      ...SUGGESTED_SUBFOLDERS[group],
      ...(folders ?? []).filter((f) => f.startsWith(top + "/")).map((f) => f.slice(top.length + 1)),
    ]),
  ].sort();
  const isSub = fixedFolder !== undefined;

  return (
    <Modal close={close}>
      <h2>{heading}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          const parts = [...(venture ? VENTURE_PART_KEYS : []), ...(log ? [DOCS_KEY] : [])];
          const folder = isSub ? fixedFolder : sub.trim() ? `${top}/${sub.trim()}` : top;
          create(title.trim(), folder, parts, isSub ? {} : { Type: group });
        }}
      >
        <div className="form-rows">
          <label className="field">
            <span className="field-label">Name</span>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Create my handwriting font" />
          </label>
          {!isSub && (
            <div className="field">
              <span className="field-label">Is it personal or a venture?</span>
              <div className="choice-row">
                {(Object.keys(PROJECT_GROUPS) as ProjectGroup[]).map((g) => (
                  <button key={g} type="button" className={group === g ? "primary" : ""} onClick={() => setGroup(g)}>
                    {g}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!isSub && (
            <label className="field">
              <span className="field-label">Inside folder (optional)</span>
              <div className="folder-row">
                <span className="path">{top}/</span>
                <input list="project-subfolders" value={sub} onChange={(e) => setSub(e.target.value)} placeholder={group === "Venture" ? "e.g. Software" : "leave empty"} />
              </div>
              <datalist id="project-subfolders">
                {subOptions.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </label>
          )}
        </div>
        <div className="field">
          <span className="field-label">What to include</span>
          <div className="parts-list">
            <label className="check">
              <input type="checkbox" checked disabled />
              Board: text, documents, videos and photos
            </label>
            <label className="check">
              <input type="checkbox" checked={venture} onChange={() => setVenture(!venture)} />
              The Venture Ideation System (Overview, Market Research, Customer Development, UI/UX, Planning, Marketing,
              Operations, Funding, Financials and Deck)
            </label>
            <label className="check">
              <input type="checkbox" checked={log} onChange={() => setLog(!log)} />
              Build log
            </label>
          </div>
          <p className="muted small no-margin">You can add these later from the project's Board.</p>
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
