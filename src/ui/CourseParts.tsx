import { useState } from "react";
import type { Item } from "../core/types";
import { displayValue, useStore, type Route } from "./hooks";
import { Modal } from "./Modal";

/**
 * On a course's page: the courses inside it (each one clickable), and a way to add more.
 * On one of those courses, a link back to the program it belongs to.
 */
export function CourseParts({ course, go, beforeChange }: { course: Item; go: (r: Route) => void; beforeChange: () => Promise<void> }) {
  const store = useStore();
  const parent = store.index.courseParent(course);
  const parts = store.index.courseParts(course);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [instructor, setInstructor] = useState("");

  if (parent) {
    return (
      <p className="small">
        <button className="link" onClick={() => go({ view: "item", id: parent.id })}>
          ← {parent.title}
        </button>
      </p>
    );
  }

  async function add() {
    if (!title.trim()) return;
    await beforeChange();
    const part = await store.addCoursePart(store.index.items.get(course.id) ?? course, title.trim(), instructor.trim());
    setAdding(false);
    setTitle("");
    setInstructor("");
    go({ view: "item", id: part.id });
  }

  return (
    <section>
      <div className="section-head">
        <h3>Courses inside this one{parts.length ? ` (${parts.length})` : ""}</h3>
        <button className="small-button" onClick={() => setAdding(true)}>
          + Add course
        </button>
      </div>
      {parts.length === 0 ? (
        <p className="muted small">For a program or certificate made of several courses. Each one gets its own page.</p>
      ) : (
        <ul className="list">
          {parts.map((p) => (
            <li key={p.id} className="row" onClick={() => go({ view: "item", id: p.id })}>
              <span className="row-title">{p.title}</span>
              <span className="muted small">{displayValue(p.fields["Instructor"])}</span>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <Modal close={() => setAdding(false)}>
          <h2>Add a course to {course.title}</h2>
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
    </section>
  );
}
