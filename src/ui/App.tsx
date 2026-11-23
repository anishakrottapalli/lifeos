import { useCallback, useEffect, useState } from "react";
import { useStore, type Route } from "./hooks";
import { Sidebar } from "./Sidebar";
import { Home } from "./Home";
import { ModuleView } from "./ModuleView";
import { BlankApp, LIST_APPS, SHOW_APP_LISTS } from "./BlankApp";
import { JournalDay, JournalList } from "./JournalView";
import { ProgramView } from "./ProgramView";
import { ItemView } from "./ItemView";
import { SettingsView } from "./SettingsView";
import { SearchPalette } from "./SearchPalette";
import { Icon } from "./icons";
import { ProjectView } from "./ProjectView";
import { ProjectsView } from "./ProjectsView";

export function App() {
  const store = useStore();
  const [route, setRoute] = useState<Route>({ view: "home" });
  const [searchOpen, setSearchOpen] = useState(false);
  const go = useCallback((r: Route) => setRoute(r), []);
  // Minimized sidebar (icons only). Remembered between openings; works without storage too.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("lifeos-sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("lifeos-sidebar-collapsed", c ? "0" : "1");
      } catch {
        /* not remembered, still works */
      }
      return !c;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggleSidebar();
      }
      if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  // Anything inside a project (its Overview, sections, module pages) opens in the project layout.
  function renderItem(id: string, details: boolean) {
    const item = store.index.items.get(id);
    const project = item && store.index.projectFor(item);
    if (item && project) return <ProjectView key={project.id} project={project} selectedId={id} details={details} go={go} />;
    if (item?.module === "journal") return <JournalDay key={id} itemId={id} go={go} />;
    return <ItemView key={id} itemId={id} go={go} />;
  }

  if (store.error) {
    return (
      <div className="center-screen">
        <h2>LifeOS couldn't open its folder</h2>
        <p className="muted">{store.error}</p>
      </div>
    );
  }
  if (!store.ready) {
    return <div className="center-screen muted">Opening your LifeOS folder…</div>;
  }

  return (
    <div className="app">
      <Sidebar route={route} go={go} collapsed={collapsed} toggle={toggleSidebar} />
      <main className="main">
        {store.storage.kind === "memory" && (
          <div className="preview-banner">Preview mode: sample data in memory. In the Mac app, this is your real LifeOS folder.</div>
        )}
        <div className="topbar">
          <button className="find-pill" onClick={() => setSearchOpen(true)} title="Search every app">
            <Icon id="search" size={18} />
            <span className="grow">Find</span>
            <kbd>⌘K</kbd>
          </button>
        </div>
        {route.view === "home" && <Home go={go} />}
        {route.view === "module" &&
          (route.id === "projects" ? <ProjectsView go={go} /> : route.id === "journal" ? <JournalList go={go} /> : (SHOW_APP_LISTS || LIST_APPS.has(route.id) ? <ModuleView key={route.id} moduleId={route.id} go={go} /> : <BlankApp key={route.id} moduleId={route.id} />))}
        {route.view === "program" && <ProgramView key={route.dir} dir={route.dir} go={go} />}
        {route.view === "item" && renderItem(route.id, route.page === "details")}
        {route.view === "settings" && <SettingsView />}
      </main>
      {searchOpen && <SearchPalette go={go} close={() => setSearchOpen(false)} />}
    </div>
  );
}
