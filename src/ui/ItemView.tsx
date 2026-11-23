import { useEffect, useRef, useState } from "react";
import type { FieldDef, Item } from "../core/types";
import { dirName, fileName, join, today } from "../core/paths";
import { inTauri } from "../core/storage";
import { displayValue, timeAgo, useStore, type Route } from "./hooks";
import { LinkPicker } from "./LinkPicker";
import { renderMarkdown } from "./markdown";
import { CourseParts } from "./CourseParts";
import { CertificatePanel } from "./CertificatePanel";
import { hasOverview } from "../core/projects";

const SAVE_DELAY = 700;

/** Section and Documentation pages keep their names; projects rename by moving their whole folder. */
const fixedName = (i: Item) => i.kind === "section" || i.kind === "docs";

export function ItemView({ itemId, go, embedded = false }: { itemId: string; go: (r: Route) => void; embedded?: boolean }) {
  const store = useStore();
  const stored = store.index.items.get(itemId);
  const [draft, setDraft] = useState<Item | undefined>(stored);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState(false);
  const [linking, setLinking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<Item | undefined>(draft);
  latest.current = draft;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  // A project's "Folder" box is the folder it sits in (e.g. "My Business/Software").
  const [parentFolder] = useState(() => (stored?.kind === "project" ? dirName(stored.folder) : ""));
  const parentRef = useRef(parentFolder);
  parentRef.current = parentFolder;

  // When the file changes outside the editor (Finder, another window) and
  // there are no unsaved edits here, show the new version.
  useEffect(() => {
    if (!dirty && stored) setDraft(stored);
  }, [stored, dirty]);

  // Save anything pending when leaving the page.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      const d = latest.current;
      if (d && dirtyRef.current) {
        if (d.kind === "project") store.moveProject(d, d.title, parentRef.current);
        else store.saveItem(d, { rename: !fixedName(d) });
      }
    },
    [store],
  );

  // Files dragged in from Finder (the Mac app only) onto a course or lesson page.
  const [dropping, setDropping] = useState(false);
  const addDropRef = useRef<(paths: string[]) => void>(() => {});
  const isCoursePage = stored?.module === "courses";
  useEffect(() => {
    if (!inTauri() || !isCoursePage) return;
    let un: (() => void) | undefined;
    let cancelled = false;
    import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
      getCurrentWebview()
        .onDragDropEvent((e) => {
          const p = e.payload;
          if (p.type === "over" || p.type === "enter") setDropping(true);
          else if (p.type === "leave") setDropping(false);
          else if (p.type === "drop") {
            setDropping(false);
            addDropRef.current(p.paths);
          }
        })
        .then((u) => {
          if (cancelled) u();
          else un = u;
        }),
    );
    return () => {
      cancelled = true;
      un?.();
    };
  }, [isCoursePage]);

  if (!draft) {
    return (
      <div className="page">
        <p className="muted">This item isn't in the folder anymore.</p>
        <button onClick={() => go({ view: "home" })}>Back to Home</button>
      </div>
    );
  }
  const mod = store.module(draft.module)!;
  // The app this note is shown in (a quote shows up in Wisdom Drops).
  const host = store.module(store.index.hostId(draft.module)) ?? mod;

  async function persist(item: Item, rename: boolean) {
    clearTimeout(timer.current);
    setStatus("Saving…");
    try {
      const saved =
        rename && item.kind === "project"
          ? await store.moveProject(item, item.title, parentRef.current)
          : await store.saveItem(item, { rename: rename && !fixedName(item) && item.kind !== "project" });
      setDirty(false);
      setStatus("Saved");
      if (saved.id !== itemId) go({ view: "item", id: saved.id });
      else setDraft(saved);
    } catch (e) {
      setStatus(`Couldn't save: ${e}`);
    }
  }

  function change(patch: Partial<Item>, opts: { rename?: boolean; now?: boolean } = {}) {
    const next = { ...latest.current!, ...patch };
    setDraft(next);
    setDirty(true);
    setStatus("Editing…");
    clearTimeout(timer.current);
    if (opts.now) persist(next, opts.rename ?? false);
    else timer.current = setTimeout(() => persist(latest.current!, false), SAVE_DELAY);
  }

  const setField = (key: string, value: unknown) => change({ fields: { ...draft.fields, [key]: value } });
  const isProject = draft.kind === "project";
  const isModulePage = draft.kind === "module";
  const isLog = draft.kind === "docs" || isModulePage;
  // Provider, Instructor, Link and Certification belong to the course; a lesson or class only has its Status.
  // A lesson is a page inside a course (even one saved before pages had a kind).
  const isLesson = draft.module === "courses" && (draft.kind === "lesson" || (!draft.kind && !!store.index.courseParent(draft)));
  const shownFields = isProject ? mod.fields : isLesson || draft.kind === "class" ? mod.fields.filter((f) => f.key === "Status") : !draft.kind ? mod.fields : [];
  const owner = store.index.projectFor(draft);
  const backlinks = store.index.backlinks(draft.id);
  const folders = store.index.subfolders(draft.module);
  const dir = dirName(draft.path);
  // A course or lesson shows the files in its folder (even ones put there in Finder) and not ones moved away.
  const { attached, inFolder } = draft.module === "courses" ? store.index.courseFiles(draft) : { attached: draft.files, inFolder: [] as string[] };
  const partLabel = draft.module === "courses" ? store.index.partLabel(draft) : "";
  // Course pages: a course shows a certificate (if it is on the main list) and files when it has no lessons;
  // a lesson only lists its classes; a class is where the files go.
  const isCourse = draft.module === "courses";
  const courseKids = isCourse ? store.index.courseParts(draft) : [];
  const hasLessons = courseKids.some((k) => k.kind === "lesson");
  const showFiles = !isCourse || draft.kind === "class" || isLesson || (!draft.kind && !hasLessons);
  // Courses › Program › Course › Lesson › this page (each part but the last is a link back up).
  const courseTrail: { label: string; open: Route }[] = [];
  if (isCourse) {
    const up: Item[] = [];
    for (let c = store.index.courseParent(draft); c; c = store.index.courseParent(c)) up.unshift(c);
    const prog = store.index.programOf(up[0] ?? draft);
    if (prog) courseTrail.push({ label: fileName(prog), open: { view: "program", dir: prog } });
    for (const c of up) courseTrail.push({ label: c.title, open: { view: "item", id: c.id } });
  }
  const courseLink = isCourse && /^https?:\/\//i.test(displayValue(draft.fields["Link"]).trim()) ? displayValue(draft.fields["Link"]).trim() : "";
  const providerName = isCourse ? displayValue(draft.fields["Provider"]).trim() : "";
  const showCertificate = isCourse && !draft.kind && !isLesson && store.index.isTopLevelCourse(draft);

  // A lesson's files: every PDF counts as a class ("Class 2 of 5"). Files left inside old class folders still show here.
  const lessonRows: { name: string; dir: string; attached: boolean }[] = [];
  if (isLesson) {
    for (const f of attached) lessonRows.push({ name: f, dir, attached: true });
    for (const f of inFolder) lessonRows.push({ name: f, dir, attached: false });
    for (const k of courseKids.filter((k) => k.kind === "class")) {
      const cf = store.index.courseFiles(k);
      for (const f of [...cf.attached, ...cf.inFolder]) lessonRows.push({ name: f, dir: dirName(k.path), attached: false });
    }
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true });
  const lessonClasses = lessonRows.filter((r) => /\.pdf$/i.test(r.name)).sort(byName);
  const lessonOthers = lessonRows.filter((r) => !/\.pdf$/i.test(r.name)).sort(byName);

  async function addCourseFilesNow(paths: string[]) {
    if (!paths.length) return;
    if (dirtyRef.current) await persist(latest.current!, false);
    const n = await store.addCourseFiles(store.index.items.get(itemId) ?? latest.current!, paths);
    setStatus(`${n} file${n === 1 ? "" : "s"} moved into this folder`);
  }
  addDropRef.current = addCourseFilesNow;

  return (
    <div className={`page item-page ${embedded ? "embedded" : ""} ${dropping ? "dropping" : ""} ${isCourse ? "course-page" : ""}`}>
      <div className="crumbs">
        {!embedded && isCourse && (
          <>
            <button className="link" onClick={() => go({ view: "module", id: "courses" })}>
              Courses
            </button>
            {courseTrail.map((t, i) => (
              <span key={i} className="crumb-step">
                <span aria-hidden="true">›</span>
                <button className="link" onClick={() => go(t.open)}>
                  {t.label}
                </button>
              </span>
            ))}
            <span className="crumb-step">
              <span aria-hidden="true">›</span>
              <span className="crumb-here">{draft.title}</span>
            </span>
          </>
        )}
        {!embedded && !isCourse && (
          <>
            <button className="link" onClick={() => go({ view: "module", id: host.id })}>
              {host.icon} {host.name}
            </button>
            {draft.folder && <span className="muted"> / {draft.folder}</span>}
          </>
        )}
        {embedded && owner && !isProject && <span className="muted small">{owner.title}</span>}
        <span className="status muted small">{status}</span>
      </div>

      <input
        className="title-input"
        value={draft.title}
        placeholder="Title"
        onChange={(e) => change({ title: e.target.value })}
        onBlur={() => dirtyRef.current && persist(latest.current!, true)}
        readOnly={fixedName(draft)}
        title={fixedName(draft) ? "Section names stay the same in every project" : undefined}
        autoFocus={draft.title === "Untitled"}
        onFocus={(e) => draft.title === "Untitled" && e.target.select()}
      />

      {partLabel && <p className="muted small no-margin">{partLabel}</p>}

      <div className="meta-row">
        {isProject ? (
          <div className="meta">
            <span className="muted small">Folder</span>
            <span className="path folder-path">LifeOS/{dir}</span>
          </div>
        ) : draft.kind || isCourse ? (
          <span />
        ) : (
        <label className="meta">
          <span className="muted small">Folder</span>
          <input
            list="folder-options"
            value={draft.folder}
            placeholder="(top of the app)"
            onChange={(e) => change({ folder: e.target.value })}
            onBlur={() => dirtyRef.current && persist(latest.current!, true)}
          />
          <datalist id="folder-options">
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </label>
        )}
        <div className="actions">
          {draft.module === "projects" && !draft.kind && (
            <button
              title="Give it its own folder with Overview, the Venture sections, a Deck and Documentation"
              onClick={async () => {
                if (dirty) await persist(latest.current!, false);
                const p = await store.convertToProject(store.index.items.get(draft.id) ?? latest.current!);
                go({ view: "item", id: p.id });
              }}
            >
              Turn into project
            </button>
          )}
          <button onClick={() => store.storage.reveal(isProject ? dir : draft.path)}>Show in Finder</button>
          {!isProject && <button onClick={() => store.storage.open(draft.path)}>Open note file</button>}
          {!fixedName(draft) && (
            <button
              className="danger"
              onClick={async () => {
                const what = isProject
                  ? `the whole "${draft.title}" project folder (its sections, modules and sub-projects)`
                  : `"${draft.title}"`;
                if (!confirm(`Move ${what} to LifeOS's trash? (It's kept in LifeOS/.trash.)`)) return;
                clearTimeout(timer.current);
                setDirty(false);
                dirtyRef.current = false;
                const parent = isProject ? store.index.parentProject(draft) : owner;
                if (isProject) await store.deleteProject(draft);
                else await store.deleteItem(draft);
                if (parent && parent.id !== draft.id) go({ view: "item", id: parent.id });
                else go({ view: "module", id: host.id });
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {shownFields.length > 0 && (
        <section className={`fields ${isCourse ? "info-row" : ""}`}>
          {providerName && (
            <span className="provider-badge" aria-hidden="true" title={providerName}>
              {/linkedin/i.test(providerName) ? "in" : providerName.charAt(0).toUpperCase()}
            </span>
          )}
          {shownFields.map((f) => (
            <FieldInput key={f.key} def={f} value={draft.fields[f.key]} onChange={(v) => setField(f.key, v)} />
          ))}
          {courseLink && (
            <button className="primary open-course" onClick={() => store.storage.openUrl(courseLink)}>
              Open course
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7 17L17 7 M9 7h8v8" />
              </svg>
            </button>
          )}
        </section>
      )}
      {isModulePage && (
        <section className="fields">
          <label className="field">
            <span className="field-label">LifeOS app it's about</span>
            <select value={displayValue(draft.fields["App"])} onChange={(e) => setField("App", e.target.value)}>
              <option value="">—</option>
              {store.modules
                .filter((m) => m.id !== "projects")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.icon} {m.name}
                  </option>
                ))}
            </select>
          </label>
          <FieldInput
            def={{ key: "Status", type: "select", options: ["Idea", "Planned", "Building", "Live"] }}
            value={draft.fields["Status"]}
            onChange={(v) => setField("Status", v)}
          />
          {draft.fields["App"] ? (
            <span className="field check">
              <button className="small-button" onClick={() => go({ view: "module", id: String(draft.fields["App"]) })}>
                Open the app →
              </button>
            </span>
          ) : null}
        </section>
      )}

      {isProject && (
        <p className="muted small">Last updated {draft.updated.replace("T", " ").slice(0, 16)}</p>
      )}

      {draft.module === "courses" && (
        <CourseParts
          course={draft}
          go={go}
          beforeChange={async () => {
            if (dirtyRef.current) await persist(latest.current!, false);
          }}
        />
      )}

      {!isProject && !isCourse && <TagInput tags={draft.tags} all={store.index.allTags()} onChange={(tags) => change({ tags }, { now: true })} />}

      {(!isProject || hasOverview(draft.body)) && (draft.module !== "courses" || isLesson) && (
      <section className="body-section">
        <div className="section-head">
          <h3>{isLog ? "Notes and build log" : "Notes"}</h3>
          <span className="row-actions">
            {isLog && (
              <button
                className="small-button"
                title="Add a dated entry at the top of the build log"
                onClick={() => {
                  setPreview(false);
                  change({ body: addLogEntry(latest.current!.body, today(), isModulePage ? "###" : "##") }, { now: true });
                }}
              >
                + Today's entry
              </button>
            )}
            <button className="small-button" onClick={() => setPreview((p) => !p)}>
              {preview ? "Edit" : "Preview"}
            </button>
          </span>
        </div>
        {preview ? (
          <div className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.body || "*Nothing written yet.*") }} />
        ) : (
          <textarea
            className="body-input"
            value={draft.body}
            placeholder="Write anything. Markdown works: # headings, - lists, **bold**."
            onChange={(e) => change({ body: e.target.value })}
          />
        )}
      </section>
      )}

      <div className="course-cols">
      {showCertificate && (
        <CertificatePanel
          dir={store.index.courseDir(draft)}
          onAdd={async (p) => {
            if (dirtyRef.current) await persist(latest.current!, false);
            await store.addCertificate({ course: store.index.items.get(itemId) ?? latest.current! }, p);
          }}
        />
      )}

      {!isProject && showFiles && (
      <section>
        <div className="section-head">
          {isLesson ? <span /> : <h3>Files</h3>}
          <span className="row-actions">
          <button
            className="small-button"
            onClick={async () => {
              const picked = await store.storage.pickFiles();
              if (!picked.length) return;
              if (draft.module === "courses") return addCourseFilesNow(picked);
              if (dirty) await persist(latest.current!, false);
              const saved = await store.addFiles(store.index.items.get(draft.id) ?? latest.current!, picked);
              setDraft(saved);
              setStatus("Files moved into LifeOS");
            }}
          >
            + Add files (or drag them here)
          </button>
          </span>
        </div>
        {(isLesson ? lessonRows.length === 0 : attached.length === 0 && inFolder.length === 0) ? (
          isCourse ? (
            <div className="drop-zone">
              <span className="drop-zone-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 16V5 M7.5 9.5L12 5l4.5 4.5 M5 19h14" />
                </svg>
              </span>
              <strong>Drag files here</strong>
              <span className="muted small">{isLesson ? "Drop the lesson's PDFs here. Each PDF is a class." : `Notes, worksheets, anything for this ${draft.kind === "class" ? "class" : "course"}.`}</span>
            </div>
          ) : (
            <p className="muted small">No files. Added files are moved (not copied) into this item's folder.</p>
          )
        ) : (
          isLesson ? (
          <ul className="list">
            {lessonClasses.map((r, i) => (
              <li key={r.dir + r.name} className="row">
                <span className="part-label muted small">Class {i + 1} of {lessonClasses.length}</span>
                <span className="row-title">{r.name.replace(/\.pdf$/i, "")}</span>
                <span className="right row-actions">
                  <button onClick={() => store.storage.open(join(r.dir, r.name))}>Open</button>
                  <button onClick={() => store.storage.reveal(join(r.dir, r.name))}>Show</button>
                  {r.attached && (
                    <button title="Detach (the file stays in the folder)" onClick={async () => setDraft(await store.removeFile(latest.current!, r.name))}>
                      Detach
                    </button>
                  )}
                </span>
              </li>
            ))}
            {lessonOthers.map((r) => (
              <li key={r.dir + r.name} className="row">
                <span className="part-label muted small">File</span>
                <span className="row-title">{r.name}</span>
                <span className="right row-actions">
                  <button onClick={() => store.storage.open(join(r.dir, r.name))}>Open</button>
                  <button onClick={() => store.storage.reveal(join(r.dir, r.name))}>Show</button>
                  {r.attached && (
                    <button title="Detach (the file stays in the folder)" onClick={async () => setDraft(await store.removeFile(latest.current!, r.name))}>
                      Detach
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          ) : (
          <ul className="list">
            {attached.map((f) => (
              <li key={f} className="row">
                <span className="row-icon">📄</span>
                <span className="row-title">{f}</span>
                <span className="right row-actions">
                  <button onClick={() => store.storage.open(join(dir, f))}>Open</button>
                  <button onClick={() => store.storage.reveal(join(dir, f))}>Show</button>
                  <button
                    title="Detach (the file stays in the folder)"
                    onClick={async () => setDraft(await store.removeFile(latest.current!, f))}
                  >
                    Detach
                  </button>
                </span>
              </li>
            ))}
            {inFolder.map((f) => (
              <li key={"in:" + f} className="row">
                <span className="row-icon">📄</span>
                <span className="row-title">{f}</span>
                <span className="right row-actions">
                  <button onClick={() => store.storage.open(join(dir, f))}>Open</button>
                  <button onClick={() => store.storage.reveal(join(dir, f))}>Show</button>
                </span>
              </li>
            ))}
          </ul>
          )
        )}
      </section>
      )}
      </div>

      <section>
        <div className="section-head">
          <h3>Links</h3>
          <button className="small-button" onClick={() => setLinking(true)}>
            + Add link
          </button>
        </div>
        {draft.links.length === 0 ? (
          <p className="muted small">Link this to anything in any app (a project, a person, a source…).</p>
        ) : (
          <ul className="list">
            {draft.links.map((l, i) => {
              const target = store.index.items.get(l.to);
              const tm = target && store.module(store.index.hostId(target.module));
              return (
                <li key={i} className="row">
                  <span className="pill">{l.kind}</span>
                  {target ? (
                    <button className="link row-title" onClick={() => go({ view: "item", id: target.id })}>
                      {tm?.icon} {target.title}
                    </button>
                  ) : (
                    <span className="row-title muted">Missing item ({l.to})</span>
                  )}
                  <span className="muted small">{tm?.name}</span>
                  <span className="right row-actions">
                    <button title="Remove link" onClick={async () => setDraft(await store.removeLink(latest.current!, i))}>
                      ✕
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h3>Linked from</h3>
        {backlinks.length === 0 ? (
          <p className="muted small">Nothing links here yet.</p>
        ) : (
          <ul className="list">
            {backlinks.map((b) => {
              const bm = store.module(store.index.hostId(b.item.module));
              return (
                <li key={b.item.id + b.kind} className="row" onClick={() => go({ view: "item", id: b.item.id })}>
                  <span className="pill">{b.kind}</span>
                  <span className="row-title">
                    {bm?.icon} {b.item.title}
                  </span>
                  <span className="muted small">{bm?.name}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <footer className="item-foot muted small">
        <span>
          File: <code>LifeOS/{draft.path}</code>
        </span>
        <span>Created {draft.created || "—"}</span>
        <span>Updated {timeAgo(draft.updated)}</span>
      </footer>

      {linking && (
        <LinkPicker
          from={draft}
          kinds={mod.linkKinds ?? ["related"]}
          close={() => setLinking(false)}
          pick={async (target, kind) => {
            setLinking(false);
            if (dirty) await persist(latest.current!, false);
            const saved = await store.addLink(store.index.items.get(draft.id) ?? latest.current!, target, kind);
            setDraft(saved);
          }}
        />
      )}
    </div>
  );
}

function FieldInput({ def, value, onChange }: { def: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const label = <span className="field-label">{def.key}</span>;
  switch (def.type) {
    case "longtext":
      return (
        <label className="field wide">
          {label}
          <textarea rows={3} value={displayValue(value)} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
    case "number":
      return (
        <label className="field">
          {label}
          <input
            type="number"
            value={value === undefined || value === null || value === "" ? "" : String(value)}
            onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          />
        </label>
      );
    case "date":
      return (
        <label className="field">
          {label}
          <input type="date" value={displayValue(value).slice(0, 10)} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
    case "checkbox":
      return (
        <label className="field check">
          <input type="checkbox" checked={value === true || value === "true"} onChange={(e) => onChange(e.target.checked)} />
          {label}
        </label>
      );
    case "select":
      return (
        <label className="field">
          {label}
          <select value={displayValue(value)} onChange={(e) => onChange(e.target.value)}>
            <option value="">—</option>
            {(def.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
            {value && !(def.options ?? []).includes(String(value)) ? <option value={String(value)}>{String(value)}</option> : null}
          </select>
        </label>
      );
    case "multiselect": {
      const list = Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
      return (
        <div className="field wide">
          {label}
          <div className="chips">
            {(def.options ?? []).map((o) => (
              <button
                key={o}
                className={`chip ${list.includes(o) ? "on" : ""}`}
                onClick={() => onChange(list.includes(o) ? list.filter((x) => x !== o) : [...list, o])}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      );
    }
    case "url":
      return (
        <label className="field">
          {label}
          <span className="url-row">
            <input type="url" value={displayValue(value)} placeholder="https://" onChange={(e) => onChange(e.target.value)} />
            {value ? (
              <a href={String(value)} target="_blank" rel="noreferrer" title="Open link">
                ↗
              </a>
            ) : null}
          </span>
        </label>
      );
    default:
      return (
        <label className="field">
          {label}
          <input value={displayValue(value)} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
  }
}

function TagInput({ tags, all, onChange }: { tags: string[]; all: string[]; onChange: (t: string[]) => void }) {
  const [text, setText] = useState("");
  const add = (t: string) => {
    const clean = t.trim().replace(/^#/, "");
    if (clean && !tags.includes(clean)) onChange([...tags, clean]);
    setText("");
  };
  const suggestions = text ? all.filter((t) => t.toLowerCase().startsWith(text.toLowerCase()) && !tags.includes(t)).slice(0, 6) : [];
  return (
    <section className="tags">
      <span className="field-label">Tags</span>
      <div className="chips">
        {tags.map((t) => (
          <span key={t} className="chip on">
            #{t}
            <button className="chip-x" onClick={() => onChange(tags.filter((x) => x !== t))}>
              ×
            </button>
          </span>
        ))}
        <input
          className="tag-input"
          value={text}
          placeholder="Add tag"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(text);
            }
          }}
          onBlur={() => text && add(text)}
        />
        {suggestions.map((s) => (
          <button key={s} className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => add(s)}>
            #{s}
          </button>
        ))}
      </div>
    </section>
  );
}

/** Put a dated entry ("## 2026-11-10") at the top of a build log, unless today's is already there. */
export function addLogEntry(body: string, date: string, level: "##" | "###"): string {
  const heading = `${level} ${date}`;
  if (body.split("\n").some((l) => l.trim() === heading)) return body;
  const entry = `${heading}\n\n- \n\n`;
  const lines = body.split("\n");
  const firstDated = lines.findIndex((l) => /^#{2,3} \d{4}-\d{2}-\d{2}\s*$/.test(l));
  if (firstDated !== -1) {
    lines.splice(firstDated, 0, ...entry.trimEnd().split("\n"), "");
    return lines.join("\n");
  }
  const logHeading = lines.findIndex((l) => /^##\s+Build log\s*$/i.test(l));
  if (logHeading !== -1) {
    lines.splice(logHeading + 1, 0, "", ...entry.trimEnd().split("\n"));
    return lines.join("\n");
  }
  return `${body.replace(/\s+$/, "")}\n\n${entry}`;
}
