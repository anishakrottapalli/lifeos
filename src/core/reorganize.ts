// The folder layout changed: no more category folders (Knowledge, Content, Career, Home). Each app gets a
// top-level folder, and the apps folded into another live inside it. When LifeOS opens, each old folder
// is moved (whole, never copied) to its new place, but only if the new one doesn't exist yet.

export interface FolderMove {
  from: string;
  to: string;
}

/** In this order: the things inside "Life" move out before "Life/Plan" becomes "Life". */
export const FOLDER_MOVES: FolderMove[] = [
  { from: "Life/To-Do & Routines", to: "To-Do & Routines" },
  { from: "Life/Plan", to: "Life" },
  { from: "Knowledge/Courses", to: "Courses" },
  { from: "Knowledge/Wisdom Drops", to: "Wisdom Drops" },
  { from: "Knowledge/Quotes & Tweets", to: "Wisdom Drops/Quotes & Tweets" },
  { from: "Knowledge/SOPs", to: "Organization/SOPs" },
  { from: "Home/Inventory", to: "Organization/Home Inventory" },
  { from: "Content/Saved", to: "Saved Content" },
  { from: "Content/Creator Studio", to: "Creator Studio" },
  { from: "Career/Job Tracker", to: "Job Tracker" },
];

/** Old category folders: removed afterwards, but only if they end up completely empty. */
export const OLD_CATEGORY_FOLDERS = ["Knowledge", "Content", "Career", "Home"];
