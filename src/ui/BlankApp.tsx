import { useStore } from "./hooks";

/**
 * Until each app is designed as its own project, its screen is just a blank page with its name.
 * Set this to true to bring the old list screens back.
 */
export const SHOW_APP_LISTS = false;

/** Apps that already have a screen worth using (a plain list) while the rest are blank. */
export const LIST_APPS = new Set(["courses", "wisdom", "organization"]);

export function BlankApp({ moduleId }: { moduleId: string }) {
  const store = useStore();
  const mod = store.module(moduleId);
  if (!mod) return <div className="page">Unknown app.</div>;
  return (
    <div className="page">
      <header className="page-head">
        <h1>
          <span className="title-icon">{mod.icon}</span> {mod.name}
        </h1>
      </header>
    </div>
  );
}
