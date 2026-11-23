// The parts of the live Markdown editor that don't need a screen: cutting a page into blocks and
// drawing one block as nice-looking HTML. (The screen part is LiveEditor.tsx.)
import { escapeHtml, inline } from "./markdown";

/** Cut a page into blocks: a code fence is one block, a run of table rows is one block, every other line is its own. */
export function splitBlocks(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (/^```/.test(line)) {
      let j = i + 1;
      while (j < lines.length && !/^```/.test(lines[j])) j++;
      const end = Math.min(j, lines.length - 1);
      out.push(lines.slice(i, end + 1).join("\n"));
      i = end + 1;
    } else if (/^\s*\|/.test(line)) {
      let j = i;
      while (j < lines.length && /^\s*\|/.test(lines[j])) j++;
      out.push(lines.slice(i, j).join("\n"));
      i = j;
    } else {
      out.push(line);
      i++;
    }
  }
  return out;
}

export type BlockKind = "blank" | "code" | "table" | "h1" | "h2" | "h3" | "h4" | "hr" | "todo" | "bullet" | "number" | "quote" | "text";

export function kindOf(text: string): BlockKind {
  if (!text.trim()) return "blank";
  if (/^```/.test(text)) return "code";
  if (/^\s*\|/.test(text)) return "table";
  const h = /^(#{1,6})\s+/.exec(text);
  if (h) return `h${Math.min(h[1].length, 4)}` as BlockKind;
  if (/^\s*(-{3,}|\*{3,})\s*$/.test(text)) return "hr";
  if (/^\s*[-*+]\s+\[[ xX]\]\s/.test(text)) return "todo";
  if (/^\s*[-*+]\s+/.test(text)) return "bullet";
  if (/^\s*\d+[.)]\s+/.test(text)) return "number";
  if (/^>\s?/.test(text)) return "quote";
  return "text";
}

/** The "- ", "1. " or "- [ ] " at the start of a list line (with its indent), if there is one. */
export function listPrefix(line: string): { indent: string; marker: string; box: boolean; full: string } | undefined {
  const m = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/.exec(line);
  return m ? { indent: m[1], marker: m[2], box: !!m[3], full: m[0] } : undefined;
}

function tableHtml(text: string): string {
  const rows = text.split("\n").map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()));
  const isRule = (r: string[]) => r.every((c) => /^:?-+:?$/.test(c) || c === "");
  const body = rows.filter((r, i) => !(i === 1 && isRule(r)));
  const head = rows.length > 1 && isRule(rows[1]) ? body[0] : undefined;
  const cells = (r: string[], tag: string) => r.map((c) => `<${tag}>${inline(c)}</${tag}>`).join("");
  const trs = (head ? body.slice(1) : body).map((r) => `<tr>${cells(r, "td")}</tr>`).join("");
  return `<table class="lb-table">${head ? `<thead><tr>${cells(head, "th")}</tr></thead>` : ""}<tbody>${trs}</tbody></table>`;
}

/** One block drawn the way it should look when you are not editing it. */
export function renderBlock(text: string): string {
  const kind = kindOf(text);
  const indent = (t: string) => Math.floor((/^(\s*)/.exec(t)?.[1].replace(/\t/g, "  ").length ?? 0) / 2);
  switch (kind) {
    case "blank":
      return "";
    case "code":
      return `<pre><code>${escapeHtml(text.replace(/^```[^\n]*\n?/, "").replace(/\n?```\s*$/, ""))}</code></pre>`;
    case "table":
      return tableHtml(text);
    case "hr":
      return "<hr />";
    case "h1":
    case "h2":
    case "h3":
    case "h4": {
      const m = /^(#{1,6})\s+(.*)$/.exec(text)!;
      const n = Math.min(m[1].length, 4);
      return `<h${n}>${inline(m[2])}</h${n}>`;
    }
    case "todo": {
      const m = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(text)!;
      const done = m[2] !== " ";
      return `<div class="lb-li lb-todo${done ? " done" : ""}" style="margin-left:${indent(text) * 24}px"><input type="checkbox" data-lb="check" ${done ? "checked" : ""} aria-label="Done" /><span>${inline(m[3])}</span></div>`;
    }
    case "bullet": {
      const m = /^\s*[-*+]\s+(.*)$/.exec(text)!;
      return `<div class="lb-li" style="margin-left:${indent(text) * 24}px"><span class="lb-mark" aria-hidden="true">•</span><span>${inline(m[1])}</span></div>`;
    }
    case "number": {
      const m = /^\s*(\d+[.)])\s+(.*)$/.exec(text)!;
      return `<div class="lb-li" style="margin-left:${indent(text) * 24}px"><span class="lb-mark lb-num">${escapeHtml(m[1])}</span><span>${inline(m[2])}</span></div>`;
    }
    case "quote":
      return `<blockquote>${inline(text.replace(/^>\s?/, ""))}</blockquote>`;
    default:
      return `<p>${inline(text)}</p>`;
  }
}

/** Tick or untick the box at the start of a to-do line. */
export function toggleTodo(text: string): string {
  return text.replace(/\[([ xX])\]/, (_, c) => (c === " " ? "[x]" : "[ ]"));
}
