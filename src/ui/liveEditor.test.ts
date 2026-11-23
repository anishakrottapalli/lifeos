import { describe, expect, it } from "vitest";
import { kindOf, listPrefix, renderBlock, splitBlocks, toggleTodo } from "./liveEditor";

describe("live Markdown editor", () => {
  it("cuts a page into blocks and joins back to the same text", () => {
    const page = "# Title\n\nSome text\n- one\n- [ ] two\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n```js\nlet x = 1;\n\nlet y = 2;\n```\nend";
    const blocks = splitBlocks(page);
    expect(blocks.join("\n")).toBe(page);
    expect(blocks).toContain("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(blocks).toContain("```js\nlet x = 1;\n\nlet y = 2;\n```");
  });

  it("keeps an unclosed code fence in one block", () => {
    expect(splitBlocks("```\nabc\ndef")).toEqual(["```\nabc\ndef"]);
  });

  it("knows what kind of line it is", () => {
    expect(kindOf("")).toBe("blank");
    expect(kindOf("## Hi")).toBe("h2");
    expect(kindOf("- [x] done")).toBe("todo");
    expect(kindOf("- item")).toBe("bullet");
    expect(kindOf("3. item")).toBe("number");
    expect(kindOf("> quote")).toBe("quote");
    expect(kindOf("---")).toBe("hr");
    expect(kindOf("plain")).toBe("text");
  });

  it("draws lines nicely and never lets text run as code", () => {
    expect(renderBlock("## Hello **there**")).toBe("<h2>Hello <strong>there</strong></h2>");
    expect(renderBlock("- [x] done")).toContain('checked');
    expect(renderBlock("- item")).toContain("•");
    expect(renderBlock("<script>alert(1)</script>")).not.toContain("<script>");
    expect(renderBlock("| a | b |\n| - | - |\n| 1 | 2 |")).toContain("<th>a</th>");
    expect(renderBlock("```\n<b>x</b>\n```")).toContain("&lt;b&gt;");
  });

  it("continues lists and ticks boxes", () => {
    expect(listPrefix("  - [ ] task")?.full).toBe("  - [ ] ");
    expect(listPrefix("2) two")?.marker).toBe("2)");
    expect(listPrefix("plain")).toBeUndefined();
    expect(toggleTodo("- [ ] a")).toBe("- [x] a");
    expect(toggleTodo("- [x] a")).toBe("- [ ] a");
  });
});
