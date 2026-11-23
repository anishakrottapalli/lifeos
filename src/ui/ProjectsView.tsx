import { useState } from "react";
import type { Item } from "../core/types";
import { displayValue, timeAgo, useStore, type Route } from "./hooks";
import { Modal } from "./Modal";
import { DOCS_KEY, PROJECT_GROUPS, type PartKey, type ProjectGroup } from "../core/projects";

export function ProjectsView({ go }: { go: (r: Route) => void }) {
  const store = useStore();
  const mod = store.module("projects")!;
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<"All" | ProjectGroup>("All");
  const allProjects = store.index.projects();
  const projects = allProjects.filter((p) => tab === "All" || displayValue(p.fields["Type"]) === tab);
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
              New project
            </button>
          </div>
        </div>
        <p className="muted">
          {allProjects.length} project{allProjects.length === 1 ? "" : "s"} · Personal and Ventures
        </p>
      </header>

      <div className="tabs" role="tablist" aria-label="Show">
        {(["All", "Personal", "Venture"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
            {t === "Venture" ? "Ventures" : t}
          </button>
        ))}
      </div>

      {projects.length === 0 ? (
        <div className="empty">
          <p>No projects yet.</p>
          <button className="primary" onClick={() => setCreating(true)}>
            Create the first one
          </button>
        </div>
      ) : (
        <table className="table flat-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Type</th>
              <th>Sub-projects</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id} onClick={() => go({ view: "item", id: p.id })}>
                <td className="strong">
                  <span style={{ paddingLeft: depth(p) * 22 }}>
                    <svg className="folder-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                    </svg>
                    {p.title}
                  </span>
                </td>
                <td>{displayValue(p.fields["Type"])}</td>
                <td className="muted">{allProjects.filter((q) => store.index.parentProject(q)?.id === p.id).length || "—"}</td>
                <td className="muted">{timeAgo(p.updated)}</td>
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
  fixedFolder,
  heading = "New project",
}: {
  close: () => void;
  create: (title: string, folder: string, parts: PartKey[], fields: Record<string, unknown>) => void;
  fixedFolder?: string;
  heading?: string;
}) {
  const [title, setTitle] = useState("");
  const [group, setGroup] = useState<ProjectGroup>("Personal");
  const [log, setLog] = useState(false);
  const top = PROJECT_GROUPS[group];
  const isSub = fixedFolder !== undefined;

  return (
    <Modal close={close} className="new-project">
      <h2>{heading}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          const parts: PartKey[] = log ? [DOCS_KEY] : [];
          const folder = isSub ? fixedFolder : top;
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
              <span className="muted small">
                Saves to <span className="strong">Projects/{top}/{title.trim() || "Name of project"}</span>
              </span>
            </div>
          )}
        </div>
        <div className="field">
          <span className="field-label">What to include</span>
          <div className="parts-columns">
            <label className="check part-col">
              <input type="checkbox" checked={log} onChange={() => setLog(!log)} />
              <span>
                Build log
                <ul className="plain muted small">
                  <li>A Documentation page</li>
                  <li>Newest entry first</li>
                </ul>
              </span>
            </label>
          </div>
          <p className="muted small no-margin note-centered">The Venture Ideation System can be added from the project's sidebar once it's created.</p>
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
