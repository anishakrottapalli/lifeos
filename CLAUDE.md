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

Each project is a folder: `<Name>/<Name>.md` is the project and its Overview (`kind: project`), then `02 Market Research.md` … `10 Deck.md` (`kind: section`, fixed names), and `Documentation.md` (`kind: docs`, the build log, newest first). `Modules/<Name>.md` (`kind: module`) is a module's own documentation and build log, with `App: <app id>` for LifeOS's own apps. Module pages never get the Venture sections. Sub-projects are project folders inside a project folder. Renaming or moving a project moves its whole folder (`rename_dir`). Templates live in `src/core/projects.ts`.

## Older Mac

The owner's MacBook (2014) runs macOS Big Sur with Safari 16.6, which LifeOS's window uses. Some libraries use class methods with private names (`#e() {}`), which that Safari can't parse, giving a blank window. `marked` was removed for this reason; the notes preview is the built-in `src/ui/markdown.ts`. `src/compat.test.ts` fails if a screen library brings that syntax back, so add every new runtime dependency to its list. The build target is es2020.

## Checks before finishing any change

`npm test`, `npx tsc --noEmit`, `npm run build`, and `cd src-tauri && cargo test`.

## Roadmap

The shell is done. Next, each app becomes its own project with special screens: the Saved Content feed, the routine engine, Creator Studio's shot strip, etc. After that: the Notion importer, the AI Ask boxes (per app; Medical, Journal and Finance are locked), the phone app, and syncing the Anywhere folders (Job Tracker, Recipes, Library).
