// Reading a Notability ".note" file: the typed text, the date, and any pictures or
// recordings inside it. A .note is a zip package. Its Session.plist is an Apple
// "keyed archive" (a binary property list) that holds the typed text. Nothing here
// uses a library, so it runs on older Macs.

export interface NoteFile {
  kind: "image" | "audio" | "pdf";
  name: string;
  data: Uint8Array;
}

export interface ParsedNote {
  title: string;
  /** The date the note was created, "2026-10-04" ("" if the file doesn't say). */
  created: string;
  /** The typed text. */
  text: string;
  files: NoteFile[];
}

// ---------- zip ----------
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** Every file in a zip, by path. Reads stored files, and compressed ones where the window supports it. */
export async function readZip(b: Uint8Array): Promise<Map<string, Uint8Array>> {
  let end = -1;
  for (let i = b.length - 22; i >= 0 && i >= b.length - 22 - 65557; i--) {
    if (u32(b, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("This isn't a Notability note file.");
  const count = u16(b, end + 10);
  let p = u32(b, end + 16);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) throw new Error("The note file is damaged.");
    const method = u16(b, p + 10);
    const size = u32(b, p + 20);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (size === 0xffffffff || local === 0xffffffff) throw new Error("This note file is too large for LifeOS to read yet.");
    const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
    const raw = b.subarray(start, start + size);
    if (method === 0) out.set(name, raw);
    else if (method === 8 && typeof DecompressionStream !== "undefined") {
      const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      out.set(name, new Uint8Array(await new Response(stream).arrayBuffer()));
    } else throw new Error("This note file is compressed in a way LifeOS can't read yet.");
  }
  return out;
}

// ---------- binary property list ----------
export interface UID {
  uid: number;
}
export interface PlistDate {
  date: number;
}
const isUID = (v: unknown): v is UID => typeof v === "object" && v !== null && "uid" in v;

function uint(b: Uint8Array, o: number, n: number): number {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + b[o + i];
  return v;
}

/** Read an Apple binary property list ("bplist00") into plain values. */
export function parseBinaryPlist(b: Uint8Array): unknown {
  const magic = String.fromCharCode(...b.subarray(0, 8));
  if (magic !== "bplist00") throw new Error("The note's text file isn't in a format LifeOS knows.");
  const t = b.length - 32;
  const offSize = b[t + 6];
  const refSize = b[t + 7];
  const count = uint(b, t + 8, 8);
  const top = uint(b, t + 16, 8);
  const tableAt = uint(b, t + 24, 8);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const memo = new Map<number, unknown>();

  const read = (index: number): unknown => {
    if (memo.has(index)) return memo.get(index);
    let o = uint(b, tableAt + index * offSize, offSize);
    const marker = b[o++];
    const hi = marker >> 4;
    let lo = marker & 15;
    const length = () => {
      if (lo !== 15) return lo;
      const m = b[o++];
      const n = 1 << (m & 15);
      const v = uint(b, o, n);
      o += n;
      return v;
    };
    let v: unknown;
    if (hi === 0) v = lo === 8 ? false : lo === 9 ? true : null;
    else if (hi === 1) v = uint(b, o, 1 << lo);
    else if (hi === 2) v = lo === 2 ? view.getFloat32(o) : view.getFloat64(o);
    else if (hi === 3) v = { date: view.getFloat64(o) } as PlistDate;
    else if (hi === 4) {
      const n = length();
      v = b.slice(o, o + n);
    } else if (hi === 5) {
      const n = length();
      v = String.fromCharCode(...b.subarray(o, o + n));
    } else if (hi === 6) {
      const n = length();
      v = new TextDecoder("utf-16be").decode(b.subarray(o, o + n * 2));
    } else if (hi === 8) v = { uid: uint(b, o, lo + 1) } as UID;
    else if (hi === 10) {
      const n = length();
      const arr: unknown[] = [];
      for (let i = 0; i < n; i++) arr.push(read(uint(b, o + i * refSize, refSize)));
      v = arr;
    } else if (hi === 13) {
      const n = length();
      const dict: Record<string, unknown> = {};
      for (let i = 0; i < n; i++) {
        const k = read(uint(b, o + i * refSize, refSize));
        dict[String(k)] = read(uint(b, o + (n + i) * refSize, refSize));
      }
      v = dict;
    } else throw new Error("The note's text file has something LifeOS can't read.");
    memo.set(index, v);
    return v;
  };
  void count;
  return read(top);
}

// ---------- Notability's keyed archive ----------
type Dict = Record<string, unknown>;

class Archive {
  objects: unknown[];
  root: Dict;
  constructor(plist: unknown) {
    const p = plist as Dict;
    this.objects = (p["$objects"] as unknown[]) ?? [];
    const rootRef = (p["$top"] as Dict)?.["root"];
    this.root = this.deref(rootRef) as Dict;
  }
  deref(v: unknown): unknown {
    return isUID(v) ? this.objects[v.uid] : v;
  }
  get(d: unknown, key: string): unknown {
    return d && typeof d === "object" ? this.deref((d as Dict)[key]) : undefined;
  }
  /** A string, or one of Apple's string objects (NS.bytes holds the characters). */
  str(v: unknown): string | undefined {
    const o = this.deref(v);
    if (typeof o === "string") return o;
    if (o && typeof o === "object") {
      const d = o as Dict;
      if (d["NS.bytes"] instanceof Uint8Array) return new TextDecoder().decode(d["NS.bytes"]);
      if (typeof d["NS.string"] === "string") return d["NS.string"];
    }
    return undefined;
  }
  /** Seconds since 2001 -> "2026-10-04" in the Mac's own time zone. */
  dateOf(v: unknown): string {
    const o = this.deref(v) as Dict | undefined;
    const secs = o && typeof o === "object" ? (o["NS.time"] as number | undefined) : undefined;
    if (typeof secs !== "number") return "";
    const d = new Date((secs + 978307200) * 1000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  /** The typed text of the note. */
  text(): string {
    const rich = this.get(this.root, "richText");
    const backing = this.get(rich, "NBAttributedBackingString");
    const coded = this.get(backing, "NBAttributedBackingStringCodingKey");
    let t = this.str(this.get(coded, "stringKey"));
    if (t === undefined) {
      // Not where it was in the notes this was made from: take the longest string in the file.
      for (const o of this.objects) {
        const s = this.str(o);
        if (s !== undefined && s.length > (t?.length ?? 0)) t = s;
      }
    }
    return (t ?? "").replace(/￼/g, "").replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  }
}

const IMAGE = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".heic", ".tiff", ".tif"];
const AUDIO = [".m4a", ".mp3", ".wav", ".aac", ".aiff", ".caf", ".ogg", ".flac"];

/** Open a Notability .note file's bytes. */
export async function parseNote(bytes: Uint8Array): Promise<ParsedNote> {
  const zip = await readZip(bytes);
  // Everything sits inside one folder named after the note; leave that folder name off.
  const inside = new Map<string, Uint8Array>();
  for (const [path, data] of zip) inside.set(path.split("/").slice(1).join("/"), data);

  const session = inside.get("Session.plist");
  if (!session) throw new Error("This doesn't look like a Notability note.");
  const arc = new Archive(parseBinaryPlist(session));
  const text = arc.text();

  let title = "";
  let created = "";
  const meta = inside.get("metadata.plist");
  if (meta) {
    try {
      const m = new Archive(parseBinaryPlist(meta));
      title = m.str(m.get(m.root, "noteName")) ?? "";
      created = m.dateOf(m.get(m.root, "noteCreationDateKey"));
    } catch {
      /* the text is what matters; the date can come from the title or file name */
    }
  }

  const files: NoteFile[] = [];
  for (const [path, data] of [...inside].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [folder, ...rest] = path.split("/");
    const name = rest.join("/");
    if (!name || name.startsWith(".") || name.includes("/")) continue;
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
    if (folder === "Images" && IMAGE.includes(ext)) files.push({ kind: "image", name, data });
    else if (folder === "Recordings" && AUDIO.includes(ext)) files.push({ kind: "audio", name, data });
    else if (folder === "PDFs" && ext === ".pdf") files.push({ kind: "pdf", name, data });
  }
  return { title, created, text, files };
}
