// A record is a plain Markdown file. The fields sit at the top between "---"
// lines (YAML "frontmatter"), and the free text is underneath. Any app that
// reads Markdown can open these files, with or without LifeOS.

import YAML from "yaml";
import type { Item, Link, ModuleDef } from "./types";
import { fileName, stripExt } from "./paths";

const RESERVED = ["id", "module", "kind", "title", "created", "updated", "tags", "links", "files"];

export interface ParsedNote {
  meta: Record<string, unknown>;
  body: string;
}

export function splitFrontmatter(text: string): ParsedNote {
  const t = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  if (!t.startsWith("---\n")) return { meta: {}, body: t };
  const end = t.indexOf("\n---", 4);
  if (end === -1) return { meta: {}, body: t };
  const yamlText = t.slice(4, end);
  const after = t.slice(end + 4).replace(/^\n+/, "");
  try {
    const meta = YAML.parse(yamlText);
    if (meta && typeof meta === "object" && !Array.isArray(meta)) {
      return { meta: meta as Record<string, unknown>, body: after };
    }
  } catch {
    // Broken fields block: keep the whole file as text so nothing is lost.
  }
  return { meta: {}, body: t };
}

function asString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function asStringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(asString).map((s) => s.trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

function asLinks(v: unknown): Link[] {
  if (!Array.isArray(v)) return [];
  const out: Link[] = [];
  for (const l of v) {
    if (typeof l === "string") out.push({ to: l, kind: "related" });
    else if (l && typeof l === "object" && "to" in l) {
      const o = l as Record<string, unknown>;
      out.push({ to: asString(o.to), kind: asString(o.kind) || "related" });
    }
  }
  return out.filter((l) => l.to);
}

/** Turn a note file into an Item. `module` is the app it was found in. */
export function parseItem(path: string, text: string, module: string, folder: string): Item {
  const { meta, body } = splitFrontmatter(text);
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (!RESERVED.includes(k)) fields[k] = v;
  }
  const id = asString(meta.id);
  return {
    id: id || `path:${path}`,
    hasId: Boolean(id),
    module,
    kind: asString(meta.kind),
    title: asString(meta.title) || stripExt(fileName(path)),
    path,
    folder,
    fields,
    tags: asStringList(meta.tags),
    links: asLinks(meta.links),
    files: asStringList(meta.files),
    body,
    created: asString(meta.created),
    updated: asString(meta.updated),
  };
}

function isEmpty(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    v === "" ||
    v === false ||
    (Array.isArray(v) && v.length === 0)
  );
}

/** Turn an Item back into note-file text. Fields keep the app's order. */
export function serializeItem(item: Item, mod?: ModuleDef): string {
  const meta: Record<string, unknown> = {};
  if (item.hasId) meta.id = item.id;
  meta.module = item.module;
  if (item.kind) meta.kind = item.kind;
  meta.title = item.title;
  if (item.created) meta.created = item.created;
  if (item.updated) meta.updated = item.updated;
  if (item.tags.length) meta.tags = item.tags;
  if (item.links.length) meta.links = item.links.map((l) => ({ to: l.to, kind: l.kind }));
  if (item.files.length) meta.files = item.files;
  const ordered = mod ? mod.fields.map((f) => f.key) : [];
  const keys = [...ordered, ...Object.keys(item.fields).filter((k) => !ordered.includes(k))];
  for (const k of keys) {
    const v = item.fields[k];
    if (!isEmpty(v)) meta[k] = v;
  }
  const yaml = YAML.stringify(meta, { lineWidth: 0 }).trimEnd();
  const body = item.body.replace(/^\n+/, "");
  return `---\n${yaml}\n---\n\n${body}${body.endsWith("\n") || !body ? "" : "\n"}`;
}
