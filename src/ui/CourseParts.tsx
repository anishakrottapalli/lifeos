import { useState } from "react";
import type { Item } from "../core/types";
import { useStore, type Route } from "./hooks";
import { Modal } from "./Modal";

/**
 * On a course's page: its lessons (each one clickable) with a way to add more, and a link back up to
 * the course or program it sits inside.
 */
function countLabel(n: number, one: string, many: string) {
  return n ? `${n} ${n === 1 ? one : many}` : "";
}

/** Each PDF in a lesson counts as a class (including any left inside old class folders). */
function classCount(store: ReturnType<typeof useStore>, lesson: Item): number {
  const pdfs = (it: Item) => {
    const f = store.index.courseFiles(it);
    return [...f.attached, ...f.inFolder].filter((n) => /\.pdf$/i.test(n)).length;
  };
  return pdfs(lesson) + store.index.courseParts(lesson).filter((c) => c.kind === "class").reduce((n, c) => n + pdfs(c), 0);
}

export function CourseParts({ course, go, beforeChange }: { course: Item; go: (r: Route) => void; beforeChange: () => Promise<void> }) {
  const store = useStore();
  const kids = store.index.courseParts(course);
  const isLesson = course.kind === "lesson";
  const isClass = course.kind === "class";
  const childKind = isLesson ? "class" : "lesson";
  const lessons = kids.filter((c) => c.kind === childKind);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  if (isClass) return null;

  async function add() {
    if (!title.trim()) return;
    await beforeChange();
    const made = isLesson
      ? await store.addCourseClass(store.index.items.get(course.id) ?? course, title.trim())
      : await store.addCourseLesson(store.index.items.get(course.id) ?? course, title.trim());
    setAdding(false);
    setTitle("");
    go({ view: "item", id: made.id });
  }

  // Classes are gone: a lesson holds its files itself, and each PDF in it counts as a class.
  if (isLesson) return null;
  return (
    <>
      <section>
        <div className="section-head">
          <h3>
            {isLesson ? "Classes" : "Lessons"}
            {lessons.length ? ` (${lessons.length})` : ""}
          </h3>
          {!isLesson && (
            <button className="small-button" onClick={() => setAdding(true)}>
              + Add {childKind}
            </button>
          )}
        </div>
        {lessons.length === 0 ? (
          <p className="muted small">{isLesson ? "Each class gets its own folder, with its own notes and files." : "Each lesson gets its own folder and holds its files."}</p>
        ) : (
          <ul className="list">
            {lessons.map((p) => (
              <li key={p.id} className="row" onClick={() => go({ view: "item", id: p.id })}>
                <span className="row-title">{p.title}</span>
                <span className="muted small">{store.index.partLabel(p)}</span>
                <span className="muted small">{countLabel(classCount(store, p), "class", "classes")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {adding && (
        <Modal close={() => setAdding(false)}>
          <h2>Add a {childKind} to {course.title}</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <div className="form-rows">
              <label className="field">
                <span className="field-label">{isLesson ? "Class name" : "Lesson name"}</span>
                <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isLesson ? "e.g. Class 1" : "e.g. 1 - Getting Started"} />
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
    </>
  );
}
