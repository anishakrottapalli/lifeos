import { useCallback, useEffect, useState } from "react";
import { useStore, type Route } from "./hooks";
import { Sidebar } from "./Sidebar";
import { Home } from "./Home";
import { ModuleView } from "./ModuleView";
import { ItemView } from "./ItemView";
import { SettingsView } from "./SettingsView";
import { SearchPalette } from "./SearchPalette";

export function App() {
  const store = useStore();
  const [route, setRoute] = useState<Route>({ view: "home" });
  const [searchOpen, setSearchOpen] = useState(false);
  const go = useCallback((r: Route) => setRoute(r), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
      if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      <Sidebar route={route} go={go} openSearch={() => setSearchOpen(true)} />
      <main className="main">
        {store.storage.kind === "memory" && (
          <div className="preview-banner">Preview mode: sample data in memory. In the Mac app, this is your real LifeOS folder.</div>
        )}
        {route.view === "home" && <Home go={go} />}
        {route.view === "module" && <ModuleView key={route.id} moduleId={route.id} go={go} />}
        {route.view === "item" && <ItemView key={route.id} itemId={route.id} go={go} />}
        {route.view === "settings" && <SettingsView />}
      </main>
      {searchOpen && <SearchPalette go={go} close={() => setSearchOpen(false)} />}
    </div>
  );
}
