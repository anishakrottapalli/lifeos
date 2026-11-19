import { useState } from "react";
import type { Item } from "../core/types";
import { displayValue, useStore, type Route } from "./hooks";
import { Modal } from "./Modal";

/**
 * On a course's page: the courses inside it (a program's courses) and its lessons, each one
 * clickable, with a way to add more. On a course or lesson inside another, a link back up.
 */
export function CourseParts({ course, go, beforeChange }: { course: Item; go: (r: Route) => void; beforeChange: () => Promise<void> }) {
  const store = useStore();
  const parent = store.index.courseParent(course);
  const children = store.index.courseParts(course);
  const lessons = children.filter((c) => c.kind === "lesson");
  const courses = children.filter((c) => c.kind !== "lesson");
  const isLesson = course.kind === "lesson";
  const [adding, setAdding] = useState<"" | "course" | "lesson">("");
  const [title, setTitle] = useState("");
  const [instructor, setInstructor] = useState("");

  const back = parent && (
    <p className="small">
      <button className="link" onClick={() => go({ view: "item", id: parent.id })}>
        ← {parent.title}
      </button>
    </p>
  );
  if (isLesson) return back || null;

  async function add() {
    if (!title.trim() || !adding) return;
    await beforeChange();
    const fresh = store.index.items.get(course.id) ?? course;
    const made =
      adding === "lesson"
        ? await store.addCourseLesson(fresh, title.trim())
        : await store.addCoursePart(fresh, title.trim(), instructor.trim());
    setAdding("");
    setTitle("");
    setInstructor("");
    go({ view: "item", id: made.id });
  }

  const list = (items: Item[]) => (
    <ul className="list">
      {items.map((p) => (
        <li key={p.id} className="row" onClick={() => go({ view: "item", id: p.id })}>
          <span className="row-title">{p.title}</span>
          <span className="muted small">{displayValue(p.fields["Instructor"])}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      {back}
      {!parent && (
        <section>
          <div className="section-head">
            <h3>Courses inside this one{courses.length ? ` (${courses.length})` : ""}</h3>
            <button className="small-button" onClick={() => setAdding("course")}>
              + Add course
            </button>
          </div>
          {courses.length === 0 ? (
            <p className="muted small">For a program or certificate made of several courses. Each one gets its own page.</p>
          ) : (
            list(courses)
          )}
        </section>
      )}

      <section>
        <div className="section-head">
          <h3>Lessons{lessons.length ? ` (${lessons.length})` : ""}</h3>
          <button className="small-button" onClick={() => setAdding("lesson")}>
            + Add lesson
          </button>
        </div>
        {lessons.length === 0 ? (
          <p className="muted small">Each lesson gets its own folder, with its own notes and files.</p>
        ) : (
          list(lessons)
        )}
      </section>

      {adding && (
        <Modal close={() => setAdding("")}>
          <h2>{adding === "lesson" ? `Add a lesson to ${course.title}` : `Add a course to ${course.title}`}</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <div className="form-rows">
              <label className="field">
                <span className="field-label">{adding === "lesson" ? "Lesson name" : "Course name"}</span>
                <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={adding === "lesson" ? "e.g. Lesson 1" : ""} />
              </label>
              {adding === "course" && (
                <label className="field">
                  <span className="field-label">Instructor</span>
                  <input value={instructor} onChange={(e) => setInstructor(e.target.value)} />
                </label>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setAdding("")}>
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
