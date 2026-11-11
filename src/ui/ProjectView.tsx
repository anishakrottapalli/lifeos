import { useState } from "react";
import type { Item } from "../core/types";
import { dirName } from "../core/paths";
import { displayValue, useStore, type Route } from "./hooks";
import { ItemView } from "./ItemView";
import { Modal } from "./Modal";
import { NewProjectModal } from "./ProjectsView";

/** A project: section menu on the left, the chosen page on the right. */
export function ProjectView({ project, selectedId, go }: { project: Item; selectedId: string; go: (r: Route) => void }) {
  const store = useStore();
  const parts = store.index.partsOf(project);
  const [adding, setAdding] = useState<"" | "module" | "sub">("");
  const parents: Item[] = [];
  let cur = store.index.parentProject(project);
  while (cur) {
    parents.unshift(cur);
    cur = store.index.parentProject(cur);
  }
  const projectRel = dirName(project.path).slice(store.module("projects")!.folder.length + 1);
  const missing = parts.sections.length < 9 || !parts.docs;

  const navItem = (i: Item, label: string) => (
    <button key={i.id} className={`nav-item ${selectedId === i.id ? "active" : ""}`} onClick={() => go({ view: "item", id: i.id })}>
      <span className="nav-label">{label}</span>
    </button>
  );

  return (
    <div className="project">
      <aside className="project-nav">
        <div className="crumbs small">
          <button className="link" onClick={() => go({ view: "module", id: "projects" })}>
            🗂️ Projects
          </button>
          {parents.map((p) => (
            <span key={p.id}>
              <span className="muted"> / </span>
              <button className="link" onClick={() => go({ view: "item", id: p.id })}>
                {p.title}
              </button>
            </span>
          ))}
        </div>
        <div className="project-title">{project.title}</div>
        {project.fields["Status"] ? <span className="pill no-margin">{displayValue(project.fields["Status"])}</span> : null}

        <div className="nav-group-title">Sections</div>
        {navItem(project, "Overview")}
        {parts.sections.map((s) => navItem(s, s.title))}
        {parts.docs && navItem(parts.docs, "Documentation")}
        {missing && (
          <button className="nav-item muted" onClick={() => store.addMissingSections(project)}>
            + Add missing sections
          </button>
        )}

        <div className="nav-group-title">Modules</div>
        {parts.modules.map((m) => navItem(m, m.title))}
        <button className="nav-item muted" onClick={() => setAdding("module")}>
          + Add module page
        </button>

        <div className="nav-group-title">Sub-projects</div>
        {parts.subprojects.map((p) => navItem(p, p.title))}
        <button className="nav-item muted" onClick={() => setAdding("sub")}>
          + New sub-project
        </button>

        {parts.notes.length > 0 && (
          <>
            <div className="nav-group-title">Other notes</div>
            {parts.notes.map((n) => navItem(n, n.title))}
          </>
        )}
      </aside>

      <div className="project-main">
        <ItemView key={selectedId} itemId={selectedId} go={go} embedded />
      </div>

      {adding === "module" && (
        <AddModuleModal
          project={project}
          close={() => setAdding("")}
          done={(id) => {
            setAdding("");
            if (id) go({ view: "item", id });
          }}
        />
      )}
      {adding === "sub" && (
        <NewProjectModal
          heading={`New sub-project in ${project.title}`}
          fixedFolder={projectRel}
          close={() => setAdding("")}
          create={async (title) => {
            const p = await store.createProject(title, projectRel);
            setAdding("");
            go({ view: "item", id: p.id });
          }}
        />
      )}
    </div>
  );
}

function AddModuleModal({ project, close, done }: { project: Item; close: () => void; done: (id?: string) => void }) {
  const store = useStore();
  const [title, setTitle] = useState("");
  const [app, setApp] = useState("");
  const existing = new Set(store.index.partsOf(project).modules.map((m) => String(m.fields["App"] ?? "")));
  const apps = store.modules.filter((m) => m.id !== "projects");
  const notYet = apps.filter((m) => !existing.has(m.id));

  return (
    <Modal close={close}>
      <h2>Add a module page to {project.title}</h2>
      <p className="muted small">
        A module page is that part's own documentation and build log. It doesn't get the Venture sections.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const name = title.trim() || apps.find((m) => m.id === app)?.name || "";
          if (!name) return;
          const page = await store.addModulePage(project, name, app || undefined);
          done(page.id);
        }}
      >
        <div className="form-rows">
          <label className="field">
            <span className="field-label">Which LifeOS app is it about? (optional)</span>
            <select value={app} onChange={(e) => setApp(e.target.value)}>
              <option value="">— Not a LifeOS app —</option>
              {apps.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.icon} {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Name</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={apps.find((m) => m.id === app)?.name ?? "e.g. Journal"}
            />
          </label>
        </div>
        <div className="modal-actions">
          {notYet.length > 0 && (
            <button
              type="button"
              className="left"
              onClick={async () => {
                for (const m of notYet) await store.addModulePage(project, m.name, m.id);
                done();
              }}
            >
              Add pages for all {notYet.length} LifeOS apps
            </button>
          )}
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={!title.trim() && !app}>
            Add
          </button>
        </div>
      </form>
    </Modal>
  );
}
