import { useState } from "react";
import { useStore, type Route } from "./hooks";

export function SearchPalette({ go, close }: { go: (r: Route) => void; close: () => void }) {
  const store = useStore();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const results = q ? store.index.search(q).slice(0, 25) : store.index.recent(10);
  const choose = (id: string) => {
    go({ view: "item", id });
    close();
  };

  return (
    <div className="modal-backdrop top" onClick={close}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="Search everything…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setSel((s) => Math.min(s + 1, results.length - 1));
            if (e.key === "ArrowUp") setSel((s) => Math.max(s - 1, 0));
            if (e.key === "Enter" && results[sel]) choose(results[sel].id);
          }}
        />
        <ul className="list">
          {results.map((i, n) => {
            const m = store.module(i.module);
            return (
              <li key={i.id} className={`row ${n === sel ? "selected" : ""}`} onMouseEnter={() => setSel(n)} onClick={() => choose(i.id)}>
                <span className="row-icon">{m?.icon}</span>
                <span className="row-title">{store.index.displayTitle(i)}</span>
                <span className="muted small">
                  {m?.name}
                  {i.folder ? ` / ${i.folder}` : ""}
                </span>
              </li>
            );
          })}
          {q && results.length === 0 && <li className="muted small pad">No matches.</li>}
        </ul>
      </div>
    </div>
  );
}
