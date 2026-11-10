import { useState } from "react";
import { GROUPS } from "../core/modules";
import { timeAgo, useStore, type Route } from "./hooks";

export function Home({ go }: { go: (r: Route) => void }) {
  const store = useStore();
  const [moduleId, setModuleId] = useState("todo");
  const [title, setTitle] = useState("");
  const recent = store.index.recent(10);
  const total = store.index.items.size;

  async function quickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const item = await store.createItem(moduleId, title.trim());
    setTitle("");
    go({ view: "item", id: item.id });
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Home</h1>
        <p className="muted">
          {total} item{total === 1 ? "" : "s"} in <code>{store.root}</code>
        </p>
      </header>

      <form className="quick-add" onSubmit={quickAdd}>
        <select value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
          {store.modules.map((m) => (
            <option key={m.id} value={m.id}>
              {m.icon} {m.name}
            </option>
          ))}
        </select>
        <input placeholder="Add something…" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="primary" type="submit">
          Add
        </button>
      </form>

      <section>
        <h2>Recent</h2>
        {recent.length === 0 ? (
          <p className="muted">Nothing yet. Pick an app on the left and add your first item.</p>
        ) : (
          <ul className="list">
            {recent.map((i) => {
              const m = store.module(i.module);
              return (
                <li key={i.id} className="row" onClick={() => go({ view: "item", id: i.id })}>
                  <span className="row-icon">{m?.icon}</span>
                  <span className="row-title">{i.title}</span>
                  <span className="muted small">{m?.name}</span>
                  <span className="muted small right">{timeAgo(i.updated)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2>Apps</h2>
        {GROUPS.map((g) => (
          <div key={g} className="app-group">
            <div className="nav-group-title">{g}</div>
            <div className="app-grid">
              {store.modules
                .filter((m) => m.group === g)
                .map((m) => (
                  <button key={m.id} className="app-card" onClick={() => go({ view: "module", id: m.id })}>
                    <span className="app-card-icon">{m.icon}</span>
                    <span className="app-card-name">{m.name}</span>
                    <span className="muted small">{(() => {
                        const n = store.index.inModule(m.id).length;
                        return `${n} item${n === 1 ? "" : "s"}`;
                      })()}
                    </span>
                  </button>
                ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
