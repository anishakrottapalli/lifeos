import { useState } from "react";
import type { Item } from "../core/types";
import { useStore } from "./hooks";

export function LinkPicker({
  from,
  kinds,
  close,
  pick,
}: {
  from: Item;
  kinds: string[];
  close: () => void;
  pick: (target: Item, kind: string) => void;
}) {
  const store = useStore();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState(kinds[0] ?? "related");
  const results = (q ? store.index.search(q) : store.index.recent(20)).filter((i) => i.id !== from.id).slice(0, 30);

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Link “{from.title}” to…</h2>
        <div className="toolbar">
          <input autoFocus className="grow" placeholder="Search every app…" value={q} onChange={(e) => setQ(e.target.value)} />
          <input
            list="kind-options"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            title="Kind of link"
            style={{ width: 140 }}
          />
          <datalist id="kind-options">
            {kinds.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        </div>
        <p className="muted small">Kind of link: “{kind || "related"}” (pick one or type your own)</p>
        <ul className="list picker">
          {results.map((i) => {
            const m = store.module(i.module);
            return (
              <li key={i.id} className="row" onClick={() => pick(i, kind.trim() || "related")}>
                <span className="row-icon">{m?.icon}</span>
                <span className="row-title">{i.title}</span>
                <span className="muted small">{m?.name}</span>
              </li>
            );
          })}
          {results.length === 0 && <li className="muted small">No matches.</li>}
        </ul>
        <div className="modal-actions">
          <button onClick={close}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
