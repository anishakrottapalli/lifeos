import { useState } from "react";
import type { FieldDef, FieldType } from "../core/types";
import { useStore } from "./hooks";

const TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "longtext", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Choice" },
  { value: "multiselect", label: "Multiple choice" },
  { value: "checkbox", label: "Checkbox" },
  { value: "url", label: "Link" },
];

export function FieldEditor({ moduleId, close }: { moduleId: string; close: () => void }) {
  const store = useStore();
  const mod = store.module(moduleId)!;
  const [fields, setFields] = useState<(FieldDef & { optionsText: string })[]>(
    mod.fields.map((f) => ({ ...f, optionsText: (f.options ?? []).join(", ") })),
  );
  const [error, setError] = useState("");

  const update = (i: number, patch: Partial<FieldDef & { optionsText: string }>) =>
    setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: number) =>
    setFields((fs) => {
      const j = i + d;
      if (j < 0 || j >= fs.length) return fs;
      const copy = [...fs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  async function save() {
    const keys = fields.map((f) => f.key.trim());
    if (keys.some((k) => !k)) return setError("Every field needs a name.");
    if (new Set(keys).size !== keys.length) return setError("Two fields have the same name.");
    if (keys.some((k) => ["id", "module", "kind", "title", "created", "updated", "tags", "links", "files"].includes(k)))
      return setError("That name is used by LifeOS itself. Pick another.");
    const out: FieldDef[] = fields.map((f) => {
      const def: FieldDef = { key: f.key.trim(), type: f.type };
      if (f.type === "select" || f.type === "multiselect") {
        def.options = f.optionsText.split(",").map((s) => s.trim()).filter(Boolean);
      }
      return def;
    });
    await store.saveFields(moduleId, out);
    close();
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>
          {mod.icon} {mod.name} fields
        </h2>
        <p className="muted small">
          Renaming a field doesn't change values already saved under the old name. They stay in the files and show under
          "Other fields".
        </p>
        <div className="field-rows">
          {fields.map((f, i) => (
            <div key={i} className="field-row">
              <input value={f.key} placeholder="Field name" onChange={(e) => update(i, { key: e.target.value })} />
              <select value={f.type} onChange={(e) => update(i, { type: e.target.value as FieldType })}>
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              {(f.type === "select" || f.type === "multiselect") && (
                <input
                  className="grow"
                  value={f.optionsText}
                  placeholder="Choices, separated by commas"
                  onChange={(e) => update(i, { optionsText: e.target.value })}
                />
              )}
              <span className="row-actions right">
                <button onClick={() => move(i, -1)} title="Move up">↑</button>
                <button onClick={() => move(i, 1)} title="Move down">↓</button>
                <button onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))} title="Remove">✕</button>
              </span>
            </div>
          ))}
        </div>
        <button onClick={() => setFields((fs) => [...fs, { key: "", type: "text", optionsText: "" }])}>+ Add field</button>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button onClick={close}>Cancel</button>
          <button className="primary" onClick={save}>
            Save fields
          </button>
        </div>
      </div>
    </div>
  );
}
