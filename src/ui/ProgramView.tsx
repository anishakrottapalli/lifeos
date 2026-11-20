import { useState } from "react";
import { fileName } from "../core/paths";
import { displayValue, useStore, type Route } from "./hooks";
import { Modal } from "./Modal";

/**
 * A program (like "UX Certificate") is only a folder in Courses with course folders inside it.
 * This page lists its courses; each one is clickable.
 */
export function ProgramView({ dir, go }: { dir: string; go: (r: Route) => void }) {
  const store = useStore();
  const courses = store.index.programCourses(dir);
  const [name, setName] = useState(fileName(dir));
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [instructor, setInstructor] = useState("");

  async function rename() {
    const clean = name.trim();
    if (!clean || clean === fileName(dir)) return;
    const next = await store.renameProgram(dir, clean);
    go({ view: "program", dir: next });
  }

  async function add() {
    if (!title.trim()) return;
    const made = await store.addCourseToProgram(dir, title.trim(), instructor.trim());
    setAdding(false);
    setTitle("");
    setInstructor("");
    go({ view: "item", id: made.id });
  }

  if (courses.length === 0) {
    return (
      <div className="page">
        <p className="muted">This program has no courses anymore.</p>
        <button onClick={() => go({ view: "module", id: "courses" })}>Back to Courses</button>
      </div>
    );
  }

  return (
    <div className="page item-page">
      <div className="crumbs">
        <button className="link" onClick={() => go({ view: "module", id: "courses" })}>
          🎓 Courses
        </button>
      </div>
      <input
        className="title-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={rename}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <p className="muted small">
        A program is a folder. Its courses are inside it. <span className="path">LifeOS/{dir}</span>
      </p>
      <div className="actions">
        <button onClick={() => store.storage.reveal(dir)}>Show in Finder</button>
        <button className="primary" onClick={() => setAdding(true)}>
          + Add course
        </button>
      </div>

      <section>
        <h3>Courses ({courses.length})</h3>
        <ul className="list">
          {courses.map((c) => (
            <li key={c.id} className="row" onClick={() => go({ view: "item", id: c.id })}>
              <span className="row-title">{c.title}</span>
              <span className="muted small">{store.index.partLabel(c)}</span>
              <span className="muted small">{displayValue(c.fields["Instructor"])}</span>
            </li>
          ))}
        </ul>
      </section>

      {adding && (
        <Modal close={() => setAdding(false)}>
          <h2>Add a course to {fileName(dir)}</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <div className="form-rows">
              <label className="field">
                <span className="field-label">Course name</span>
                <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">Instructor</span>
                <input value={instructor} onChange={(e) => setInstructor(e.target.value)} />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button className="primary" type="submit" disabled={!title.trim()}>
                Add
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
