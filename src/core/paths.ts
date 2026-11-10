export function dirName(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function fileName(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function extName(name: string): string {
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i);
}

export function stripExt(name: string): string {
  const e = extName(name);
  return e ? name.slice(0, -e.length) : name;
}

export function join(...parts: string[]): string {
  return parts
    .filter((p) => p !== "")
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/^\//, "")
    .replace(/\/$/, "");
}

/** Make a title safe to use as a file or folder name on a Mac. */
export function safeName(title: string): string {
  const cleaned = title
    .replace(/[\/\\:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 120)
    .trim();
  return cleaned || "Untitled";
}

/** Clean a sub-folder path typed by the user ("My Business / Software"). */
export function safeFolder(folder: string): string {
  return folder
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p && p !== "." && p !== "..")
    .map(safeName)
    .join("/");
}

export function datePrefix(kind: "month" | "day" | undefined, iso: string): string {
  if (!kind) return "";
  return kind === "month" ? iso.slice(0, 7) : iso.slice(0, 10);
}

/** "Chicken Curry" + existing names → "Chicken Curry 2" if needed. */
export function uniqueName(base: string, ext: string, taken: (name: string) => boolean): string {
  let name = base + ext;
  let n = 2;
  while (taken(name)) {
    name = `${base} ${n}${ext}`;
    n++;
  }
  return name;
}

export function isNote(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local date and time, e.g. "2026-11-10T15:42:07" (readable in the note file). */
export function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${today()}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
