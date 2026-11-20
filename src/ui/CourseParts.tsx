import { useState } from "react";
import type { Item } from "../core/types";
import { fileName } from "../core/paths";
import { useStore, type Route } from "./hooks";
import { Modal } from "./Modal";

/**
 * On a course's page: its lessons (each one clickable) with a way to add more, and a link back up to
 * the course or program it sits inside.
 */
export function CourseParts({ course, go, beforeChange }: { course: Item; go: (r: Route) => void; beforeChange: () => Promise<void> }) {
  const store = useStore();
  const parent = store.index.courseParent(course);
  const program = store.index.programOf(course);
  const kids = store.index.courseParts(course);
  const lessons = kids.filter((c) => c.kind === "lesson");
  // Other notes (pages) sitting in this course's or lesson's folder, for example ones made in Finder.
  const notes = kids.filter((c) => c.kind !== "lesson" && !store.index.isCourseFolder(c));
  const isLesson = course.kind === "lesson";
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  const back =
    parent || program ? (
      <p className="small">
        <button
          className="link"
          onClick={() => (parent ? go({ view: "item", id: parent.id }) : go({ view: "program", dir: program! }))}
        >
          ← {parent ? parent.title : fileName(program!)}
        </button>
      </p>
    ) : null;
  const notesList = notes.length > 0 && (
    <section>
      <h3>Notes in this folder ({notes.length})</h3>
      <ul className="list">
        {notes.map((n) => (
          <li key={n.id} className="row" onClick={() => go({ view: "item", id: n.id })}>
            <span className="row-title">{n.title}</span>
          </li>
        ))}
      </ul>
    </section>
  );
  if (isLesson)
    return (
      <>
        {back}
        {notesList}
      </>
    );

  async function add() {
    if (!title.trim()) return;
    await beforeChange();
    const lesson = await store.addCourseLesson(store.index.items.get(course.id) ?? course, title.trim());
    setAdding(false);
    setTitle("");
    go({ view: "item", id: lesson.id });
  }

  return (
    <>
      {back}
      {notesList}
      <section>
        <div className="section-head">
          <h3>Lessons{lessons.length ? ` (${lessons.length})` : ""}</h3>
          <button className="small-button" onClick={() => setAdding(true)}>
            + Add lesson
          </button>
        </div>
        {lessons.length === 0 ? (
          <p className="muted small">Each lesson gets its own folder, with its own notes and files.</p>
        ) : (
          <ul className="list">
            {lessons.map((p) => (
              <li key={p.id} className="row" onClick={() => go({ view: "item", id: p.id })}>
                <span className="row-title">{p.title}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {adding && (
        <Modal close={() => setAdding(false)}>
          <h2>Add a lesson to {course.title}</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <div className="form-rows">
              <label className="field">
                <span className="field-label">Lesson name</span>
                <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 1 - Getting Started" />
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

/** On a course's page: bring in Notability notes (.note files) for this course. */
export function CourseNoteImport({ course, beforeChange }: { course: Item; beforeChange: () => Promise<void> }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ imported: number; problems: string[] } | null>(null);

  async function run() {
    const picked = await store.storage.pickFiles();
    if (!picked.length) return;
    setBusy(true);
    try {
      await beforeChange();
      setResult(await store.importCourseNotes(store.index.items.get(course.id) ?? course, picked));
    } catch (e) {
      setResult({ imported: 0, problems: [`Something went wrong: ${e}`] });
    }
    setBusy(false);
  }

  return (
    <>
      <button className="small-button" onClick={run} disabled={busy} title="Bring in Notability notes (.note files) or PDFs for this course">
        {busy ? "Importing…" : "+ Import notes (.note or PDF)"}
      </button>
      {result && (
        <Modal close={() => setResult(null)}>
          <h2>Import finished</h2>
          <p>
            {result.imported} file{result.imported === 1 ? "" : "s"} added to {course.title}.
          </p>
          {result.problems.length > 0 && (
            <>
              <p className="muted small">These need a look:</p>
              <ul className="plain">
                {result.problems.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </>
          )}
          <div className="modal-actions">
            <button className="primary" onClick={() => setResult(null)}>
              OK
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
