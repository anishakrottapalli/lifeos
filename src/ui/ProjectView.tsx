import type { Item } from "../core/types";
import { displayValue, useStore, type Route } from "./hooks";
import { ItemView } from "./ItemView";
import { Board } from "./Board";

/** A project: its Board (or the page you opened from it) on the right, its pages on the left. */
export function ProjectView({
  project,
  selectedId,
  details = false,
  go,
}: {
  project: Item;
  selectedId: string;
  details?: boolean;
  go: (r: Route) => void;
}) {
  const store = useStore();
  const parts = store.index.partsOf(project);
  const parents: Item[] = [];
  let cur = store.index.parentProject(project);
  while (cur) {
    parents.unshift(cur);
    cur = store.index.parentProject(cur);
  }
  const onBoard = selectedId === project.id && !details;

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

        <button className={`nav-item ${onBoard ? "active" : ""}`} onClick={() => go({ view: "item", id: project.id })}>
          <span className="nav-label">🧩 Board</span>
        </button>
        <button
          className={`nav-item ${selectedId === project.id && details ? "active" : ""}`}
          onClick={() => go({ view: "item", id: project.id, page: "details" })}
        >
          <span className="nav-label">Details</span>
        </button>

        {parts.notes.length > 0 && (
          <>
            <div className="nav-group-title">Other notes</div>
            {parts.notes.map((n) => navItem(n, n.title))}
          </>
        )}
      </aside>

      <div className={`project-main ${onBoard ? "on-board" : ""}`}>
        {onBoard ? (
          <Board project={project} go={go} />
        ) : (
          <>
            <button className="link back-to-board small" onClick={() => go({ view: "item", id: project.id })}>
              ← Board
            </button>
            <ItemView key={selectedId + (details ? ":d" : "")} itemId={selectedId} go={go} embedded />
          </>
        )}
      </div>

    </div>
  );
}
