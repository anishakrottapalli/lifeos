import { GROUPS } from "../core/modules";
import { useStore, type Route } from "./hooks";

export function Sidebar({ route, go, openSearch }: { route: Route; go: (r: Route) => void; openSearch: () => void }) {
  const store = useStore();
  const activeModule =
    route.view === "module" ? route.id : route.view === "item" ? store.index.items.get(route.id)?.module : undefined;

  return (
    <nav className="sidebar">
      <div className="brand" onClick={() => go({ view: "home" })}>
        <span className="brand-mark">◆</span> LifeOS
      </div>
      <button className="search-button" onClick={openSearch}>
        <span>Search</span>
        <kbd>⌘K</kbd>
      </button>
      <button className={`nav-item ${route.view === "home" ? "active" : ""}`} onClick={() => go({ view: "home" })}>
        <span className="nav-icon">⌂</span> Home
      </button>
      {GROUPS.map((g) => (
        <div key={g} className="nav-group">
          <div className="nav-group-title">{g}</div>
          {store.modules
            .filter((m) => m.group === g)
            .map((m) => (
              <button
                key={m.id}
                className={`nav-item ${activeModule === m.id ? "active" : ""}`}
                onClick={() => go({ view: "module", id: m.id })}
                title={m.description}
              >
                <span className="nav-icon">{m.icon}</span>
                <span className="nav-label">{m.name}</span>
                {m.storage === "anywhere" && <span className="badge" title="Anywhere group: syncs">☁</span>}
                {m.locked && <span className="badge" title="Locked: private">🔒</span>}
                <span className="count">{store.index.inModule(m.id).length || ""}</span>
              </button>
            ))}
        </div>
      ))}
      <div className="sidebar-foot">
        <button className={`nav-item ${route.view === "settings" ? "active" : ""}`} onClick={() => go({ view: "settings" })}>
          <span className="nav-icon">⚙</span> Settings
        </button>
      </div>
    </nav>
  );
}
