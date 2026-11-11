# LifeOS

Your files, organized by what they're for, with everything linked.

LifeOS is a Mac app that sits on top of **one folder, `Documents/LifeOS`**. Everything you add is saved there as normal files you can open in Finder. If LifeOS ever goes away, every file and folder is still there.

## Opening LifeOS on your Mac (first time)

You don't need to know how to code. Open **Claude Code** on your Mac and paste this:

> Clone https://github.com/anishakrottapalli/lifeos into my home folder. Check that I have the Xcode Command Line Tools, Rust (via rustup) and Node.js installed, and install whatever is missing. Then run `npm install` and `npm run app` inside the lifeos folder to open LifeOS.

The first launch takes a few minutes while everything is set up. After that, `npm run app` opens it in seconds.

**To get a real app icon in your Applications folder**, ask Claude Code:

> In my lifeos folder, run `npm run app:build` and copy LifeOS.app from src-tauri/target/release/bundle/macos into my Applications folder.

The first time you open it, macOS may say it's from an unidentified developer. Right-click LifeOS.app → **Open** → **Open**. You only need to do this once.

## Opening and updating LifeOS (after the one-time setup)

- **To open:** click **LifeOS** in Applications or the Dock, like any app.
- **To update** (only when the app itself changes): double-click **Update LifeOS** in your `lifeos` folder. It gets the newest version, rebuilds, and replaces the app in Applications. Your files in Documents/LifeOS are never touched.

### One-time setup

1. **Make a GitHub access key** (works on macOS Big Sur; the `gh` helper needs macOS 12+). On github.com: profile picture → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**. Name: LifeOS Mac · Expiration: the longest option · Repository access: only **lifeos** · Permissions: **Contents: Read-only**. Generate it and copy it (GitHub shows it only once).
2. **Your Mac remembers it.** In step 3, Terminal asks for a username (`anishakrottapalli`) and a password: paste the key (nothing shows) and press Enter. macOS saves it in the Keychain.
3. **Swap the ZIP copy for a connected copy** (keeps the already-built parts):
   `cd ~ && mv lifeos lifeos-old && git clone https://github.com/anishakrottapalli/lifeos.git && mv lifeos-old/node_modules lifeos/ && mv lifeos-old/src-tauri/target lifeos/src-tauri/ && mv lifeos-old ~/.Trash/`
4. **Double-click Update LifeOS** (in Finder, your home folder → lifeos). The first build takes 20–40 minutes, and LifeOS then opens from Applications. Drag it to your Dock. Tip: right-click **Update LifeOS** → **Make Alias**, and put the alias on your Desktop.

## How your files are organized

```
Documents/LifeOS/
├── Career/Job Tracker/
├── Content/Saved/ · Content/Creator Studio/
├── Family/
├── Finance/
├── Health/Medical/          ← e.g. Blood Tests/2026-03 Blood Test.md + .pdf
├── Home/Inventory/
├── Journal/
├── Knowledge/Quotes & Tweets/ · Wisdom Drops/ · Courses/ · SOPs/
├── Library/
├── Life/Plan/ · Life/To-Do & Routines/
├── Photos & Videos/
├── Projects/                ← My Business/Software/…, Personal/…
├── Recipes/
├── Wardrobe/
├── .lifeos/modules.json     ← (hidden) your field changes
└── .trash/                  ← (hidden) deleted items, recoverable
```

- **Each item is a Markdown note** (`.md`). Its fields sit at the top, your writing goes underneath. Any notes app can open it.
- **Attached files sit next to their note** and are **moved, not copied**, in, so there's only ever one copy.
- **Finder works too.** Add, rename or move files in Finder and LifeOS picks up the change. Files dropped into an app's folder show up under "Loose files", where one click turns them into an item.
- **Links** between items (in any app) are saved inside the note files, so they survive without the app. Every item shows what links to it under "Linked from".
- **Deleting** moves things into the hidden `.trash` folder (press ⌘⇧. in Finder to see hidden folders).

## Projects

Every project is its own folder with a **Board**: a freeform canvas, like a Figma board. Add text cards, drag in pictures, videos and files from Finder (or use **+ Pictures, videos & files**), and move everything wherever you like. Files you add are moved into the project's folder.

When you make a project, tick what else it needs. A small project ("Create my handwriting font") can be just the Board. A business idea can have everything from the Venture Ideation System: an **Overview** (lean canvas), **Market Research, Customer Development, UI/UX, Planning, Marketing, Operations, Funding, Financials**, a **Deck** page, and a **Documentation** page for the build log. These pages sit on the Board as cards; click one to open it. **+ Add a section** on the Board adds any you skipped. **Details** holds the project's status, type and folder.

- **Sub-projects** are project folders inside a project (e.g. My Business → LifeOS).
- **Module pages** (inside a project's `Modules/` folder) are one page per part, like each LifeOS app, with its own documentation and build log. Module pages don't get the Venture sections. Each LifeOS app has a **Docs** button that opens its page.

## What's in this first version

- All 19 apps, each with its own folder and fields
- Create, edit, rename and delete items; changes save automatically
- Fields per app, plus **Fields** to add, remove or reorder them
- Sub-folders (e.g. `My Business/Software`, `Blood Tests`)
- Tags, search across everything (⌘K), and two-way links with "Linked from"
- Attach files (moved into LifeOS), open them, or show them in Finder
- Loose-file pickup for things added in Finder
- Settings: choose a different LifeOS folder, reread the folder

Not yet: importing from Notion, the AI Ask boxes, each app's special screens (the Saved Content feed, the routine engine, etc.), the phone app, and syncing the Anywhere folders. Each app becomes its own project after this.

## For Claude Code: how the code is laid out

- `src-tauri/` is the Rust helper: the only part that touches the disk. Every path is relative to the LifeOS folder and can't escape it.
- `src/core/` holds the logic, with no screens:
  - `notes.ts`: reading and writing note files
  - `index.ts`: the in-memory index, rebuilt from the folder
  - `store.ts`: every action
  - `modules.ts`: the 19 apps
- `src/ui/` holds the React screens.
- `npm test` runs the core tests. `npm run dev` opens a browser preview with sample data (no real files). `cd src-tauri && cargo test` tests the Rust helper.
