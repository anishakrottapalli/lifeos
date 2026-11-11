// What every project is made of. A project is a folder:
//
//   Projects/My Business/Software/LifeOS/
//   ├── LifeOS.md                  ← the project itself, plus 1. Overview
//   ├── 02 Market Research.md      ← Venture sections, one note each
//   ├── …
//   ├── 10 Deck.md                 ← attach the deck here
//   ├── Documentation.md           ← the project's build log
//   └── Modules/
//       └── Journal.md             ← a module's own documentation + build log
//
// Sub-projects are folders inside a project folder. Module pages don't get the
// Venture sections (only projects do).

export type ProjectKind = "project" | "section" | "docs" | "module";

export interface SectionDef {
  /** File name without .md, also the section title. */
  file: string;
  title: string;
  template: string;
}

export const OVERVIEW_TEMPLATE = `## Overview of the business

What it is, in one or two sentences.

## Lean canvas

- **Problem:**
- **Customer segments:**
- **Unique value proposition:**
- **Solution:**
- **Channels:**
- **Revenue streams:**
- **Cost structure:**
- **Key metrics:**
- **Unfair advantage:**
`;

export const SECTIONS: SectionDef[] = [
  {
    file: "02 Market Research",
    title: "Market Research",
    template: `External research: the market and the competition.

## Markets and why they matter

## Competitive analysis

| Competitor | Product core | Size of user base | Design | Brand | Speed | Revenue model |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |

## Feature comparison

## Problem statements

## Unique value proposition
`,
  },
  {
    file: "03 Customer Development",
    title: "Customer Development",
    template: `Internal research: talking to the people it's for.

## User interviews

- Interview guide:
- Key quotes and pain points:

## User surveys

## User personas
`,
  },
  {
    file: "04 UI-UX",
    title: "UI/UX",
    template: `## Feature list

## User flows

## User scenarios and stories

## User journey maps

## Information architecture / sitemap

## Sketches

## MVP scope

## Prototypes and usability testing

## Final designs and design system
`,
  },
  {
    file: "05 Planning",
    title: "Planning",
    template: `## Product strategy

- Success metrics:

## Roadmap

- Requirements:
- Timeline and release plans:
- Epic specs:
- Sprint plans:
`,
  },
  {
    file: "06 Marketing",
    title: "Marketing",
    template: `## Launch plan

## Go-to-market strategy

## Messaging

## Brand position

## Growth channels (organic, paid, partnerships)
`,
  },
  {
    file: "07 Operations",
    title: "Operations",
    template: `## Roles and job descriptions

## Legal structure

## Org chart

## Partnerships

## Tech stack and tools
`,
  },
  {
    file: "08 Funding",
    title: "Funding",
    template: `## How much I'm raising

## Use of funds

## Timeline and stages of fundraising
`,
  },
  {
    file: "09 Financials",
    title: "Financials",
    template: `## Revenue model

## Forecasts

## Key assumptions

## Breakeven and burn rate
`,
  },
  {
    file: "10 Deck",
    title: "Deck",
    template: `Attach the deck (Keynote, PowerPoint or PDF) with **+ Add files** below.

## Slide outline

1. Cover
2. Problem
3. Solution
4. Product
5. Market
6. Competition
7. Business model
8. Go-to-market
9. Traction
10. Team
11. Vision
12. The ask
13. Contact
`,
  },
];

export const DOCS_FILE = "Documentation";

export function buildLogEntry(date: string, first = false): string {
  return `## ${date}\n\n- ${first ? "Started the project." : ""}\n`;
}

export function docsTemplate(date: string): string {
  return `The build log: what changed and why, newest first. Keep entries short.

${buildLogEntry(date, true)}`;
}

export function moduleTemplate(date: string): string {
  return `What this module does, how it works, and its build log.

## What it does

## How it works

## Open questions

## Build log

### ${date}

- Added this page.
`;
}

export const MODULES_FOLDER = "Modules";

// ---------- choosing a project's parts ----------
// When a project is created, you pick which parts it gets. Every project has a
// Board; the rest (Overview, the Venture sections, Deck, Documentation) are
// optional and can be added later from the Board.

/** "overview", "docs", or a section's file name (e.g. "02 Market Research"). */
export type PartKey = string;

export const OVERVIEW_KEY = "overview";
export const DOCS_KEY = "docs";

export interface PartDef {
  key: PartKey;
  label: string;
}

export const ALL_PARTS: PartDef[] = [
  { key: OVERVIEW_KEY, label: "Overview (lean canvas)" },
  ...SECTIONS.map((s) => ({ key: s.file, label: s.title })),
  { key: DOCS_KEY, label: "Documentation (build log)" },
];

export const ALL_PART_KEYS: PartKey[] = ALL_PARTS.map((p) => p.key);

/** True when a project's Overview text has been started (so it shows on the Board). */
export function hasOverview(body: string): boolean {
  return body.trim().length > 0;
}
