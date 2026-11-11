import { useState } from "react";
import { useStore } from "./hooks";

export function SettingsView() {
  const store = useStore();
  const [msg, setMsg] = useState("");

  return (
    <div className="page">
      <header className="page-head">
        <h1>Settings</h1>
      </header>

      <section className="card">
        <h3>LifeOS folder</h3>
        <p>
          <code>{store.root}</code>
        </p>
        <p className="muted small">
          Everything LifeOS knows lives in this one folder as normal files you can open in Finder. If LifeOS ever goes away,
          your files are still here.
        </p>
        <div className="actions">
          <button onClick={() => store.storage.reveal("")}>Show in Finder</button>
          <button
            onClick={async () => {
              const picked = await store.storage.pickFolder();
              if (!picked) return;
              await store.changeRoot(picked);
              setMsg(`Now using ${picked}`);
            }}
          >
            Use a different folder…
          </button>
        </div>
        <p className="muted small">
          Changing the folder doesn't move anything; LifeOS just starts reading the folder you pick. To move your LifeOS,
          quit the app, move the folder in Finder, then pick its new place here.
        </p>
      </section>

      <section className="card">
        <h3>Index</h3>
        <p className="muted small">
          The index makes search fast. It's rebuilt from your files whenever they change, so it's never the only copy of
          anything.
        </p>
        <div className="actions">
          <button
            onClick={async () => {
              await store.rebuild();
              setMsg(`Reread ${store.index.items.size} items from the folder.`);
            }}
          >
            Reread the whole folder
          </button>
        </div>
      </section>

      <section className="card">
        <h3>How your files are organized</h3>
        <ul className="plain">
          <li>Each item is a Markdown note file (.md); each project is one .lifeos file. A Journal day is a folder holding its text, pictures and recordings. Its fields sit at the top; your writing goes underneath.</li>
          <li>Attached files sit next to their note, in the same folder, and are moved (not copied) in.</li>
          <li>Changes you make in Finder show up here automatically.</li>
          <li>
            Deleted items go to <code>LifeOS/.trash</code> (hidden). Press ⌘⇧. in Finder to see hidden folders.
          </li>
          <li>
            Field lists you edit are saved in <code>LifeOS/.lifeos/modules.json</code>.
          </li>
        </ul>
      </section>
      {msg && <p className="muted">{msg}</p>}
    </div>
  );
}
