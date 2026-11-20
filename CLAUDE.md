# LifeOS: notes for Claude Code

The owner is not a coder. Explain changes in plain language, and keep the app minimal.

## Principles (don't break these)

1. **Files are the truth.** Everything lives in one folder (default `~/Documents/LifeOS`). Each record is a Markdown note with YAML frontmatter. The in-memory index is only for speed and must always be rebuildable from the folder.
2. **One copy of everything.** Adding a file *moves* it into LifeOS. Never copy-and-leave, and never overwrite: on a name clash, add " 2".
3. **Finder works.** Changes made outside the app (add, rename, move) must show up in the app. Plain `.md` files with no frontmatter are valid items.
4. **One home, many appearances.** An item lives in exactly one app (decided by its folder). Other apps reference it through `links` (`{to: id, kind}`), never copies. "Linked from" is computed.
5. **Deleting moves to `LifeOS/.trash/`**, never deletes for real.
6. The Rust side (`src-tauri/src/lib.rs`) only accepts paths relative to the LifeOS folder (`safe_join`). Keep it that way.

## Layout

- `src/core/modules.ts`: the built-in apps (id, folder, fields). User field edits go in `LifeOS/.lifeos/modules.json`.
- `src/core/notes.ts`: note file format. Reserved keys: id, module, kind, title, created, updated, tags, links, files, board. All other keys are fields.
- `src/core/store.ts`: all actions, run one at a time through a queue.
- `src/ui/*`: React screens. `src/core/storage-memory.ts` is a fake folder for browser previews and tests.

## Projects app

Each project is a folder: `<Name>/<name>.lifeos` is the project (`kind: project`; the name in lowercase with no spaces, e.g. `ventureideationsystem.lifeos`). It is the same note format (fields at the top, text below) and also holds the Board layout. Older projects (`<Name>.md` plus `projectboard.lifeos`) are read as before and become one `.lifeos` file on their next save. Its text is the Overview (lean canvas) when there is one; an empty body means the project has no Overview. New projects are Personal (`Projects/Personal`) or Venture (`Projects/Ventures`), saved as the `Type` field. Optional parts, picked in the New project window (the Venture Ideation System = `VENTURE_PART_KEYS`, and the build log) or added later from the Board: `02 Market Research.md` … `10 Deck.md` (`kind: section`, fixed names) and `Documentation.md` (`kind: docs`, the build log, newest first). `Modules/<Name>.md` (`kind: module`) is a module's own documentation and build log, with `App: <app id>` for LifeOS's own apps. Module pages never get the Venture sections. Sub-projects are project folders inside a project folder. Renaming or moving a project moves its whole folder (`rename_dir`). Templates live in `src/core/projects.ts`.

**The Board / artboard** (`src/ui/Board.tsx`, laid out like Figma) is every project's main screen: a freeform canvas. The project's pages (`projectPages`: Overview, sections, Documentation) and non-media files are small desktop-style **icons** (click selects, double-click opens; a Markdown file opens in a reader window); pictures, videos and text stay as cards. The left sidebar (`src/ui/ProjectView.tsx`) lists the same things: the pages as tabs, then "On the artboard" with every file and text card; clicking a page tab opens it, clicking anything else selects it on the artboard (a `board-select` event, `cardKey`). Cards: Its layout is the project file's reserved `board:` list (`BoardCard`: `text` cards hold their text, `file` cards name a file in the project folder, `page` cards point at a section/docs page id or `overview`). Files dropped or added on the Board are moved into the project folder under their own names and listed in the note's `files`, so they never show as loose. Pages and files not yet on the Board get a card automatically. Removing a file card moves the file to `.trash`. Pictures and videos are shown through Tauri's asset protocol: `open_root` allows only the LifeOS folder, and `full_path` turns a relative path into a full one (still via `safe_join`).

## Journal app

`Journal/<date>/<date>.md` is a day's writing (`openJournalDay`); pictures, videos and audio recordings are separate files in the same folder, kept under their own names. A line in the text like `![](photo.jpg)` (or a video or audio file) shows that file at that spot; `renderMarkdown(text, resolver)` draws it. Files in the folder that the text doesn't mention are listed under the text, so files added in Finder show up. Pasting a copied picture into the writing saves it as its own file (`addJournalPicture`, Rust `write_bytes`, which never overwrites) and puts it at the cursor. **Import from Notability** (Journal screen, `importNoteFiles`) opens `.note` files with `src/core/notability.ts` (a zip holding `Session.plist`, a binary keyed archive, plus `Images/` and `Recordings/`; no library): the typed text becomes the day's writing, the day comes only from the date in the note's title (`dateFromName` in `src/core/journal.ts`; never the file name or created date, which can be a different day), and a title with no date becomes the entry's own folder, `Journal/<title>/<title>.md` ("Title 2" if a different entry has that title). Pictures/recordings become files placed at the end of the text (where Notability puts them isn't known yet). The `.note` is staged in `Journal/.import` and moved to `.trash` once read. Handwriting can't be converted. Screens: `src/ui/JournalView.tsx`. Other apps are blank pages for now (`src/ui/BlankApp.tsx`), except the ones in `LIST_APPS` (Courses), which use the plain list screen `src/ui/ModuleView.tsx`.

## Courses app

`Knowledge/Courses/<title>.md`, fields Instructor, Link and Status (Up Next / Ongoing / Completed; every page also has Files, notes, tags and links). The list table has no Folder or Updated columns. Everything in Courses was marked Completed once (`markCoursesCompletedOnce`, remembered by `LifeOS/.lifeos/courses-status-completed`). A **program** (several courses, like the UX Certificate) is **only a folder**, `Courses/<Program>/`, with no page of its own; each course in it is a folder with its own page, `Courses/<Program>/<Course>/<Course>.md` (order in a `Part` number), so its files sit with it. A course (in a program or on its own) can hold **lessons** (`kind: lesson`), each a folder of its own (`.../<Course>/<Lesson>/<Lesson>.md`, `addCourseLesson`). Any course with lessons is a folder (`makeCourseFolderNow` moves it and its files); renaming one renames its folder (`renameCourseFolderNow`). Index helpers in `src/core/index.ts`: `isCourseFolder`, `courseParts`, `courseParent`, `programs`, `programOf`, `programCourses`, `isTopLevelCourse`. The Courses list shows standalone courses and one row per program (`+ New program` makes one with its first course); a program has its own screen (`src/ui/ProgramView.tsx`, route `{view:"program", dir}`) listing its courses. The courses were moved over from Notion with a one-time import, which has since been removed. A course or lesson page has no Notes box and no "Other fields" section (no page does); it shows a "Part 1 of 7" / "Lesson 2 of 6" label (`partLabel`, counted by position) and **every file in its folder** (`courseFiles`): the files it was told about that are still there, plus any others put there in Finder; files moved away in Finder are left out. **+ Add files** (any kinds, many at once) and dragging files from Finder onto the page both call `addCourseFiles`, which moves them into the course's folder under their own names (never overwriting) and gives a course on its own a folder first. The old "Import notes" button and the typed Notes box are gone (older text stays in the files).

## Older Mac

The owner's MacBook (2014) runs macOS Big Sur with Safari 16.6, which LifeOS's window uses. Some libraries use class methods with private names (`#e() {}`), which that Safari can't parse, giving a blank window. `marked` was removed for this reason; the notes preview is the built-in `src/ui/markdown.ts`. `src/compat.test.ts` fails if a screen library brings that syntax back, so add every new runtime dependency to its list. The build target is es2020.

## Checks before finishing any change

`npm test`, `npx tsc --noEmit`, `npm run build`, and `cd src-tauri && cargo test`.

## Roadmap

The shell is done. Next, each app becomes its own project with special screens: the Saved Content feed, the routine engine, Creator Studio's shot strip, etc. After that: the Notion importer, the AI Ask boxes (per app; Medical, Journal and Finance are locked), the phone app, and syncing the Anywhere folders (Job Tracker, Recipes, Library).
