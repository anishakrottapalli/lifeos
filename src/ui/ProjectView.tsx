import type { Item } from "../core/types";
import { displayValue, useStore, type Route } from "./hooks";
import { ItemView } from "./ItemView";
import { Board, projectPages } from "./Board";
import { extName } from "../core/paths";

const IMAGE = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"];
const VIDEO = [".mp4", ".mov", ".m4v", ".webm"];
function iconFor(name: string) {
  const e = extName(name).toLowerCase();
  return IMAGE.includes(e) ? "🖼️" : VIDEO.includes(e) ? "🎬" : [".md", ".markdown", ".txt"].includes(e) ? "📝" : "📎";
}

/**
 * A project, laid out like Figma: the left side lists everything on the artboard (pages as tabs, then
 * pictures, videos, files and text), and the artboard, or the page you opened, is on the right.
 */
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
  const pages = projectPages(store.index, project);
  const hasOverviewTab = pages.some((p) => p.open.view === "item" && p.open.page === "details");

  /** Select something on the artboard (going back to the artboard first if a page is open). */
  function showOnBoard(key: string) {
    if (!onBoard) go({ view: "item", id: project.id });
    setTimeout(() => window.dispatchEvent(new CustomEvent("board-select", { detail: key })), onBoard ? 0 : 200);
  }
  const textCards = (project.board ?? []).filter((c) => c.type === "text" || c.type === "embed" || c.type === "section");

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
          <span className="nav-label">🧩 Artboard</span>
        </button>
        <button
          className={`nav-item ${selectedId === project.id && details && !hasOverviewTab ? "active" : ""}`}
          onClick={() => go({ view: "item", id: project.id, page: "details" })}
        >
          <span className="nav-label">Details</span>
        </button>

        {pages.length > 0 && (
          <>
            <div className="nav-group-title">Pages</div>
            {pages.map((p) => {
              const active = p.open.view === "item" && (p.open.page === "details" ? selectedId === project.id && details : selectedId === p.open.id);
              return (
                <button key={p.key} className={`nav-item ${active ? "active" : ""}`} onClick={() => go(p.open)} title="Open this page">
                  <span className="nav-label">📄 {p.title}</span>
                </button>
              );
            })}
          </>
        )}

        {(project.files.length > 0 || textCards.length > 0) && (
          <>
            <div className="nav-group-title">On the artboard</div>
            {project.files.map((f) => (
              <button key={"f:" + f} className="nav-item" onClick={() => showOnBoard("f:" + f)} title="Show on the artboard">
                <span className="nav-label">
                  {iconFor(f)} {f}
                </span>
              </button>
            ))}
            {textCards.map((c) => (
              <button key={"t:" + c.id} className="nav-item" onClick={() => showOnBoard("t:" + c.id)} title="Show on the artboard">
                <span className="nav-label">
                  {c.type === "embed" ? "🔗" : c.type === "section" ? "▭" : "📝"} {(c.text ?? "").trim().split("\n")[0].slice(0, 40) || (c.type === "section" ? "Section" : "Text")}
                </span>
              </button>
            ))}
          </>
        )}

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
              ← Artboard
            </button>
            <ItemView key={selectedId + (details ? ":d" : "")} itemId={selectedId} go={go} embedded />
          </>
        )}
      </div>

    </div>
  );
}
