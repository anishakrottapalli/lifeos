export type FieldType =
  | "text"
  | "longtext"
  | "number"
  | "date"
  | "select"
  | "multiselect"
  | "checkbox"
  | "url";

export interface FieldDef {
  /** The name written into the note file (e.g. "Who said it"). */
  key: string;
  type: FieldType;
  options?: string[];
}

export type StorageGroup = "anywhere" | "mac";

export interface ModuleDef {
  id: string;
  name: string;
  icon: string;
  /** Folder inside LifeOS/, e.g. "Health/Medical". */
  folder: string;
  /** Sidebar section. */
  group: string;
  description: string;
  fields: FieldDef[];
  /** Put the date in front of new file names. */
  datePrefix?: "month" | "day";
  storage: StorageGroup;
  /** Private: never shared with other apps or the AI unless turned on. */
  locked?: boolean;
  /** A short note shown at the top of the app. */
  note?: string;
  /** Suggested kinds of links for this app. */
  linkKinds?: string[];
}

export interface Link {
  to: string;
  kind: string;
}

/** One thing on a project's Board. Saved in the project note's `board:` list. */
export interface BoardCard {
  id: string;
  /** text: a note card · file: a picture, video or other file in the project folder · page: a section/page of the project */
  type: "text" | "file" | "page";
  x: number;
  y: number;
  /** Width in px (height grows with the content). */
  w?: number;
  text?: string;
  /** For file cards: the file name, in the project folder. */
  file?: string;
  /** For page cards: the page's id, or "overview" for the project's own Overview. */
  page?: string;
}

export interface Item {
  id: string;
  /** False when the note file has no id yet (e.g. made in Finder). */
  hasId: boolean;
  module: string;
  /** For Projects: "project", "section", "docs" or "module" ("" otherwise). */
  kind: string;
  title: string;
  /** Note file path, relative to LifeOS/. */
  path: string;
  /** Sub-folder inside the module's folder ("" for the top). */
  folder: string;
  fields: Record<string, unknown>;
  tags: string[];
  links: Link[];
  /** Attached file names, in the same folder as the note. */
  files: string[];
  body: string;
  /** Projects only: the cards on the project's Board. */
  board?: BoardCard[];
  created: string;
  updated: string;
}

export interface Entry {
  path: string;
  mtime: number;
  size: number;
}

export interface Settings {
  root?: string | null;
}
