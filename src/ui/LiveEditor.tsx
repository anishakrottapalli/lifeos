import { useEffect, useRef, useState } from "react";
import { kindOf, listPrefix, renderBlock, splitBlocks, toggleTodo } from "./liveEditor";

/**
 * A Markdown page that reads like Notion: every line you are not editing is drawn nicely (headings big,
 * bullets as bullets, boxes you can tick). The line you are on shows its Markdown so you can type it.
 * The page is still plain Markdown text; nothing here changes how it is saved.
 */
export function LiveEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [blocks, setBlocks] = useState<string[]>(() => splitBlocks(value));
  const [active, setActive] = useState(-1);
  const pending = useRef<{ idx: number; pos: number } | null>(null);
  const areas = useRef<(HTMLTextAreaElement | null)[]>([]);
  const sent = useRef(value);

  // The file changed somewhere else (Finder, another window): show the new text.
  useEffect(() => {
    if (value !== sent.current && value !== blocks.join("\n")) {
      setBlocks(splitBlocks(value));
      setActive(-1);
    }
    sent.current = value;
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // After a change of the line being edited, put the cursor where it belongs.
  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    const el = areas.current[p.idx];
    if (el) {
      el.focus();
      el.setSelectionRange(p.pos, p.pos);
      pending.current = null;
    }
  });

  // When you leave the page, tidy it: a code fence or table typed line by line becomes one block.
  useEffect(() => {
    if (active !== -1) return;
    setBlocks((b) => {
      const norm = splitBlocks(b.join("\n"));
      return norm.length === b.length && norm.every((x, i) => x === b[i]) ? b : norm;
    });
  }, [active]);

  function commit(next: string[], focus?: { idx: number; pos: number }) {
    const list = next.length ? next : [""];
    setBlocks(list);
    const text = list.join("\n");
    sent.current = text;
    onChange(text);
    if (focus) {
      pending.current = focus;
      setActive(focus.idx);
    }
  }

  function goTo(idx: number, pos: number) {
    pending.current = { idx, pos };
    setActive(idx);
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>, i: number) {
    const ta = e.currentTarget;
    const text = blocks[i];
    const kind = kindOf(text);
    const pos = ta.selectionStart;
    const multi = kind === "code" || kind === "table";
    const prefix = listPrefix(text);

    if (e.key === "Escape") {
      setActive(-1);
      return;
    }
    if (e.key === "Enter" && !multi && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const before = text.slice(0, pos);
      const after = text.slice(ta.selectionEnd);
      const bp = listPrefix(before);
      if (bp && before.length === bp.full.length && !after.trim()) {
        // Enter on an empty bullet ends the list.
        commit(blocks.map((b, k) => (k === i ? "" : b)), { idx: i, pos: 0 });
        return;
      }
      let next = "";
      if (bp && before.length >= bp.full.length) {
        const n = /^\d/.test(bp.marker) ? `${parseInt(bp.marker, 10) + 1}${bp.marker.replace(/^\d+/, "")}` : bp.marker;
        next = `${bp.indent}${n} ${bp.box ? "[ ] " : ""}`;
      }
      commit([...blocks.slice(0, i), before, next + after, ...blocks.slice(i + 1)], { idx: i + 1, pos: next.length });
      return;
    }
    if (e.key === "Backspace" && ta.selectionStart === ta.selectionEnd) {
      if (prefix && pos === prefix.full.length) {
        e.preventDefault();
        commit(blocks.map((b, k) => (k === i ? text.slice(prefix.full.length) : b)), { idx: i, pos: 0 });
        return;
      }
      if (pos === 0 && i > 0) {
        e.preventDefault();
        const prev = blocks[i - 1];
        commit([...blocks.slice(0, i - 1), prev + text, ...blocks.slice(i + 1)], { idx: i - 1, pos: prev.length });
        return;
      }
    }
    if (e.key === "Tab" && prefix) {
      e.preventDefault();
      const nextText = e.shiftKey ? text.replace(/^( {1,2}|\t)/, "") : "  " + text;
      const delta = nextText.length - text.length;
      commit(blocks.map((b, k) => (k === i ? nextText : b)), { idx: i, pos: Math.max(0, pos + delta) });
      return;
    }
    const oneLine = ta.scrollHeight <= parseFloat(getComputedStyle(ta).lineHeight || "28") * 1.6;
    if (e.key === "ArrowUp" && i > 0 && !text.slice(0, pos).includes("\n") && (oneLine || pos === 0)) {
      e.preventDefault();
      goTo(i - 1, Math.min(pos, blocks[i - 1].length));
    } else if (e.key === "ArrowDown" && i < blocks.length - 1 && !text.slice(pos).includes("\n") && (oneLine || pos === text.length)) {
      e.preventDefault();
      goTo(i + 1, Math.min(pos, blocks[i + 1].length));
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>, i: number) {
    const pasted = e.clipboardData.getData("text/plain").replace(/\r\n/g, "\n");
    if (!pasted.includes("\n")) return;
    e.preventDefault();
    const ta = e.currentTarget;
    const text = blocks[i];
    const combined = text.slice(0, ta.selectionStart) + pasted + text.slice(ta.selectionEnd);
    const pieces = splitBlocks(combined);
    const lastLine = pasted.split("\n").pop() ?? "";
    const last = pieces[pieces.length - 1] ?? "";
    commit([...blocks.slice(0, i), ...pieces, ...blocks.slice(i + 1)], {
      idx: i + pieces.length - 1,
      pos: Math.min(lastLine.length, last.length),
    });
  }

  // Pressing on a drawn line starts editing it (on press, so the screen doesn't shift under the click).
  function onReadDown(e: React.MouseEvent, i: number) {
    const el = e.target as HTMLElement;
    if (el.closest("a") || el.dataset.lb === "check") return;
    e.preventDefault();
    goTo(i, blocks[i].length);
  }

  function onReadClick(e: React.MouseEvent, i: number) {
    if ((e.target as HTMLElement).dataset.lb === "check") {
      e.preventDefault();
      commit(blocks.map((b, k) => (k === i ? toggleTodo(b) : b)));
    }
  }

  function clickBelow() {
    const lastIdx = blocks.length - 1;
    if (blocks[lastIdx].trim() === "" || kindOf(blocks[lastIdx]) === "code") return goTo(lastIdx, blocks[lastIdx].length);
    commit([...blocks, ""], { idx: blocks.length, pos: 0 });
  }

  const empty = blocks.length === 1 && blocks[0] === "";

  return (
    <div className="live-editor" role="textbox" aria-multiline="true" aria-label="Page text">
      {blocks.map((b, i) =>
        i === active ? (
          <textarea
            key={i}
            ref={(el) => {
              areas.current[i] = el;
              if (el) {
                el.style.height = "auto";
                el.style.height = `${el.scrollHeight}px`;
              }
            }}
            className={`lb-input lb-k-${kindOf(b)}`}
            value={b}
            rows={1}
            spellCheck
            placeholder={empty ? "Write anything. Markdown works: # headings, - lists, **bold**." : undefined}
            onChange={(e) => commit(blocks.map((x, k) => (k === i ? e.target.value : x)))}
            onKeyDown={(e) => onKey(e, i)}
            onPaste={(e) => onPaste(e, i)}
            onBlur={() => setActive((a) => (a === i ? -1 : a))}
          />
        ) : (
          <div key={i} className={`lb lb-k-${kindOf(b)}`} onMouseDown={(e) => onReadDown(e, i)} onClick={(e) => onReadClick(e, i)}>
            {b.trim() ? <div dangerouslySetInnerHTML={{ __html: renderBlock(b) }} /> : <div className="lb-gap">{empty ? <span className="lb-hint">Write anything. Markdown works: # headings, - lists, **bold**.</span> : null}</div>}
          </div>
        ),
      )}
      <div className="lb-below" onMouseDown={(e) => { e.preventDefault(); clickBelow(); }} aria-hidden="true" />
    </div>
  );
}
