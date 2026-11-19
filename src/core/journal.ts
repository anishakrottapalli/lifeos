// Small helpers for the Journal: telling what kind of file something is, writing
// the line that puts a file in the text, and reading a date out of a file name.

import { extName } from "./paths";

const IMAGE = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".heic"];
const VIDEO = [".mp4", ".mov", ".m4v", ".webm"];
const AUDIO = [".m4a", ".mp3", ".wav", ".aac", ".aiff", ".caf", ".ogg", ".flac"];

export type MediaKind = "image" | "video" | "audio" | "other";

export function kindOf(name: string): MediaKind {
  const e = extName(name).toLowerCase();
  return IMAGE.includes(e) ? "image" : VIDEO.includes(e) ? "video" : AUDIO.includes(e) ? "audio" : "other";
}

/** The line that puts a file in the text: ![](photo.jpg). Spaces and brackets are escaped so it stays one piece. */
export function mediaLine(name: string): string {
  return `![](${encodeURIComponent(name).replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function valid(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (y < 1900 || y > 2100 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${y}-${p(m)}-${p(d)}`;
}

/**
 * Find a date in a file name and return it as "2026-11-11" ("" if there isn't one).
 * Understands 2025-03-14, 3/14/2025 (month first), "March 14, 2025" and "14 March 2025".
 */
export function dateFromName(name: string): string {
  const s = name.replace(/\.[^.]+$/, "").replace(/_/g, " ");
  const month = (w: string) => MONTHS.indexOf(w.slice(0, 3).toLowerCase()) + 1;
  const mname = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  let m = /\b(\d{4})[-./](\d{1,2})[-./](\d{1,2})\b/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = new RegExp(`${mname}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`, "i").exec(s);
  if (m) return valid(+m[3], month(m[1]), +m[2]);
  m = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+${mname}\\.?,?\\s+(\\d{4})`, "i").exec(s);
  if (m) return valid(+m[3], month(m[2]), +m[1]);
  m = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/.exec(s);
  if (m) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  return "";
}
