import { useStore, type Route } from "./hooks";

export function Sidebar({
  route,
  go,
  openSearch,
  collapsed,
  toggle,
}: {
  route: Route;
  go: (r: Route) => void;
  openSearch: () => void;
  collapsed: boolean;
  toggle: () => void;
}) {
  const store = useStore();
  const current =
    route.view === "module" ? route.id : route.view === "program" ? "courses" : route.view === "item" ? store.index.items.get(route.id)?.module : undefined;
  // A note from an app folded into another (a quote in Wisdom Drops) lights up the app it is shown in.
  const activeModule = current ? store.index.hostId(current) : undefined;

  return (
    <nav className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="brand-row">
        <div className="brand" onClick={() => go({ view: "home" })} title="Home">
          <span className="brand-mark">◆</span>
          <span className="side-text"> LifeOS</span>
        </div>
        <button className="collapse-button" onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Minimize sidebar"} title={collapsed ? "Expand sidebar" : "Minimize sidebar"}>
          {collapsed ? "»" : "«"}
        </button>
      </div>
      <button className="search-button" onClick={openSearch} title="Search">
        <span className="search-icon">⌕</span>
        <span className="side-text grow">Search</span>
        <kbd className="side-text">⌘K</kbd>
      </button>
      <button className={`nav-item ${route.view === "home" ? "active" : ""}`} onClick={() => go({ view: "home" })} title="Home">
          <span className="nav-icon">⌂</span> <span className="nav-label">Home</span>
      </button>
      {store.modules
        .filter((m) => !m.hidden)
        .map((m) => (
          <button
            key={m.id}
            className={`nav-item ${activeModule === m.id ? "active" : ""}`}
            onClick={() => go({ view: "module", id: m.id })}
            title={collapsed ? m.name : m.description}
          >
            <span className="nav-icon">{m.icon}</span>
            <span className="nav-label">{m.name}</span>
            {m.storage === "anywhere" && <span className="badge side-text" title="Anywhere group: syncs">☁</span>}
            {m.locked && <span className="badge side-text" title="Locked: private">🔒</span>}
            <span className="count side-text">{store.index.countFor(m.id) || ""}</span>
          </button>
        ))}
      <div className="sidebar-foot">
        <button className={`nav-item ${route.view === "settings" ? "active" : ""}`} onClick={() => go({ view: "settings" })} title="Settings">
          <span className="nav-icon">⚙</span> <span className="nav-label">Settings</span>
        </button>
      </div>
    </nav>
  );
}
