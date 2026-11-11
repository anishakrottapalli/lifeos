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
- `src/core/notes.ts`: note file format. Reserved keys: id, module, title, created, updated, tags, links, files. All other keys are fields.
- `src/core/store.ts`: all actions, run one at a time through a queue.
- `src/ui/*`: React screens. `src/core/storage-memory.ts` is a fake folder for browser previews and tests.

## Projects app

Each project is a folder: `<Name>/<Name>.md` is the project (`kind: project`). Its text is the Overview (lean canvas) when there is one; an empty body means the project has no Overview. New projects are Personal (`Projects/Personal`) or Venture (`Projects/Ventures`), saved as the `Type` field. Optional parts, picked in the New project window (the Venture Ideation System = `VENTURE_PART_KEYS`, and the build log) or added later from the Board: `02 Market Research.md` … `10 Deck.md` (`kind: section`, fixed names) and `Documentation.md` (`kind: docs`, the build log, newest first). `Modules/<Name>.md` (`kind: module`) is a module's own documentation and build log, with `App: <app id>` for LifeOS's own apps. Module pages never get the Venture sections. Sub-projects are project folders inside a project folder. Renaming or moving a project moves its whole folder (`rename_dir`). Templates live in `src/core/projects.ts`.

**The Board** (`src/ui/Board.tsx`) is every project's main screen: a freeform canvas of cards. Its layout is saved in `projectboard.lifeos` (JSON) next to the project note; an older `board:` list in the note is still read and moves to that file on the next save (`BoardCard`: `text` cards hold their text, `file` cards name a file in the project folder, `page` cards point at a section/docs page id or `overview`). Files dropped or added on the Board are moved into the project folder under their own names and listed in the note's `files`, so they never show as loose. Pages and files not yet on the Board get a card automatically. Removing a file card moves the file to `.trash`. Pictures and videos are shown through Tauri's asset protocol: `open_root` allows only the LifeOS folder, and `full_path` turns a relative path into a full one (still via `safe_join`).

## Older Mac

The owner's MacBook (2014) runs macOS Big Sur with Safari 16.6, which LifeOS's window uses. Some libraries use class methods with private names (`#e() {}`), which that Safari can't parse, giving a blank window. `marked` was removed for this reason; the notes preview is the built-in `src/ui/markdown.ts`. `src/compat.test.ts` fails if a screen library brings that syntax back, so add every new runtime dependency to its list. The build target is es2020.

## Checks before finishing any change

`npm test`, `npx tsc --noEmit`, `npm run build`, and `cd src-tauri && cargo test`.

## Roadmap

The shell is done. Next, each app becomes its own project with special screens: the Saved Content feed, the routine engine, Creator Studio's shot strip, etc. After that: the Notion importer, the AI Ask boxes (per app; Medical, Journal and Finance are locked), the phone app, and syncing the Anywhere folders (Job Tracker, Recipes, Library).
