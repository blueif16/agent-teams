import { describe, expect, it } from "vitest";
import { read } from "./fixtures";
import { excalidrawFrames, excalidrawTexts, htmlTextRuns, htmlTokens, mdBlocks, mdHeadings, mdLines, mdPlain, numerals, parseNumber, parseTable, sentences } from "./parse";

describe("parseTable: CSV", () => {
  const plans = parseTable(read("plans.csv"));

  it("names the columns from the header row and keys each row by them", () => {
    expect(plans.columns).toEqual(["vendor", "plan", "list_price", "billing_unit", "seats", "usd_month", "limits", "url", "accessed", "quote"]);
    expect(plans.rows).toHaveLength(6);
    expect(plans.rows[2].vendor).toBe("CrewAI");
    expect(plans.rows[2].url).toBe("https://www.crewai.com/pricing");
  });

  it("keeps a quoted comma inside its cell", () => {
    expect(plans.rows[0].limits).toBe("5,000 tasks/mo, 3 agents");
    expect(plans.rows[0].url).toBe("https://www.lindy.ai/pricing");
  });

  it("reads a doubled quote inside a quoted cell as one quote", () => {
    expect(plans.rows[3].quote).toBe('"Pro" plan: $33.33/mo, billed annually');
  });

  it("keeps a quoted line break inside its cell and accepts CRLF records", () => {
    const t = parseTable('name,note\r\nLindy,"two\r\nlines"\r\nn8n,one\r\n');
    expect(t.rows).toEqual([
      { name: "Lindy", note: "two\r\nlines" },
      { name: "n8n", note: "one" },
    ]);
  });

  it("skips blank lines and fills a short row with empty cells", () => {
    const t = parseTable("a,b,c\n1,2,3\n\n4,5\n\n");
    expect(t.rows).toEqual([
      { a: "1", b: "2", c: "3" },
      { a: "4", b: "5", c: "" },
    ]);
  });

  it("strips a byte-order mark from the first header", () => {
    expect(parseTable("\uFEFFvendor,plan\nLindy,Pro\n").columns).toEqual(["vendor", "plan"]);
  });
});

describe("parseTable: Markdown", () => {
  const memo = read("memo.md");

  it("reads a table whose delimiter row has alignment colons, trimming cell padding", () => {
    const t = parseTable(memo);
    expect(t.columns).toEqual(["Tier", "Price (USD/mo)", "Features"]);
    expect(t.rows.map((r) => r.Tier)).toEqual(["Solo", "Team", "Practice"]);
    expect(t.rows[1]["Price (USD/mo)"]).toBe("79");
  });

  it("reads the first table of a doc and stops where it ends", () => {
    const t = parseTable(memo, "markdown");
    expect(t.rows).toHaveLength(3);
    expect(t.columns).not.toContain("Risk");
  });

  it("reads an escaped pipe as part of the cell", () => {
    const t = parseTable("| plan | limits |\n|---|---|\n| Pro | 5 agents \\| 3 seats |\n");
    expect(t.rows).toEqual([{ plan: "Pro", limits: "5 agents | 3 seats" }]);
  });

  it("finds no table in a doc without one", () => {
    expect(parseTable("# Notes\n\nNo table here, just prose.\n", "markdown")).toEqual({ columns: [], rows: [] });
  });

  it("reads CSV as CSV when told to, even if a cell looks like a Markdown row", () => {
    const t = parseTable('a\n"| x |"\n"|---|"\n', "csv");
    expect(t.rows).toEqual([{ a: "| x |" }, { a: "|---|" }]);
  });
});

describe("parseNumber", () => {
  it("reads dollar amounts with thousands separators and cents", () => {
    expect(parseNumber("$1,299.00")).toBe(1299);
  });

  it("reads plain integers, decimals and percentages", () => {
    expect(parseNumber("1299")).toBe(1299);
    expect(parseNumber(" 33.33 ")).toBe(33.33);
    expect(parseNumber("12.5%")).toBe(12.5);
    expect(parseNumber("-3")).toBe(-3);
  });

  it("reads only a whole cell as a number: text, blanks, bad separators and trailing words are not numbers", () => {
    expect(["Contact sales", "", "1,29", "12 seats", "$49"].map(parseNumber)).toEqual([null, null, null, null, 49]);
  });
});

describe("numerals", () => {
  it("finds the numbers a sentence states", () => {
    expect(numerals("Notes within 2 minutes, in 12.5% of the time, for $1,299.00.")).toEqual([2, 12.5, 1299]);
  });

  it("ends a number at a full stop", () => {
    expect(numerals("We launched in 2025.")).toEqual([2025]);
  });

  it("skips digits that are part of a name, such as section labels and fact tags", () => {
    expect(numerals("S3 covers 40 B2B teams, see F12")).toEqual([40]);
  });

  it("reads a date's parts and a ratio's sides as separate numbers", () => {
    expect(numerals("Accessed 2026-10-15, open 24/7")).toEqual([2026, 10, 15, 24, 7]);
  });
});

describe("mdHeadings", () => {
  it("returns each ATX heading with its level, as plain text", () => {
    const hs = mdHeadings(read("copy.md"));
    expect(hs[0]).toEqual({ level: 1, text: "Tern landing page copy" });
    expect(hs.filter((h) => h.level === 2).map((h) => h.text)).toEqual(["S1 Hero", "S2 Problem", "S3 How it works", "S4 Proof", "S5 Teams", "S6 Start"]);
    expect(hs.filter((h) => h.level === 3)[1].text).toBe("You can't listen and type at the same time");
  });

  it("strips closing hashes and emphasis", () => {
    expect(mdHeadings("## **Market** map ##\n")).toEqual([{ level: 2, text: "Market map" }]);
  });

  it("ignores hashtags and lines inside code fences", () => {
    expect(mdHeadings("#launch day\n```\n## not a heading\n```\n### Real\n")).toEqual([{ level: 3, text: "Real" }]);
  });
});

describe("mdPlain", () => {
  it("strips emphasis, inline code and strikethrough", () => {
    expect(mdPlain("Pilot users saved **3.5 hours** a *week* with `tern` ~~maybe~~")).toBe("Pilot users saved 3.5 hours a week with tern maybe");
  });

  it("keeps a link's text and an image's alt, dropping the URLs", () => {
    expect(mdPlain("[Start your free trial](#start) ![Tern logo](logo.png) <https://tern.example>")).toBe("Start your free trial Tern logo https://tern.example");
  });

  it("strips underscore emphasis around whole words only, leaving snake_case and fact tags alone", () => {
    expect(mdPlain("usd_month is _not_ list_price [F3]")).toBe("usd_month is not list_price [F3]");
  });
});

describe("mdBlocks and mdLines", () => {
  const copy = read("copy.md");

  it("joins a wrapped paragraph into one block, numbered by its first line", () => {
    const b = mdBlocks(copy).find((x) => x.text.startsWith("Positioning:"));
    expect(b).toEqual({ kind: "para", line: 3, text: "Positioning: for consultants who meet clients in person, Tern is the meeting recorder that turns the conversation into notes before you reach the car. [F1][F2]" });
  });

  it("keeps headings, list items and table rows as their own blocks, without their markers", () => {
    const blocks = mdBlocks("## Plan\n- Solo at $29\n- Team at $79\n| a | b |\n|---|---|\n| 1 | 2 |\n");
    expect(blocks.map((b) => [b.kind, b.text])).toEqual([
      ["heading", "Plan"],
      ["item", "Solo at $29"],
      ["item", "Team at $79"],
      ["row", "| a | b |"],
      ["row", "| 1 | 2 |"],
    ]);
  });

  it("lists each non-empty body line, plain, without headings", () => {
    const lines = mdLines(copy).map((l) => l.text);
    expect(lines).toContain("Start your free trial");
    expect(lines).toContain("Tern works offline in basements and on client sites, and uploads when you are back online. [F3]");
    expect(lines).not.toContain("S1 Hero");
    expect(lines).not.toContain("Meeting notes that write themselves");
  });
});

describe("sentences", () => {
  it("splits at a full stop, question or exclamation mark followed by a space, not inside a decimal", () => {
    expect(sentences("Saved 3.5 hours. Worth it? Yes!")).toEqual(["Saved 3.5 hours.", "Worth it?", "Yes!"]);
  });

  it("keeps tags written after the full stop with the sentence before them", () => {
    expect(sentences("Notes in 2 minutes. [F2][F1] Works offline. [F3]")).toEqual(["Notes in 2 minutes. [F2][F1]", "Works offline. [F3]"]);
  });
});

describe("htmlTextRuns", () => {
  const runs = htmlTextRuns(read("landing.html"));

  it("returns the page's text nodes with whitespace collapsed and entities decoded", () => {
    expect(runs).toContain("You can't listen and type at the same time");
    expect(runs).toContain("Start your free trial");
    expect(runs).toContain("© Tern Labs");
  });

  it("splits text at inline tags", () => {
    expect(runs).toContain("Pilot users saved");
    expect(runs).toContain("3.5 hours");
  });

  it("leaves out script, style and the document title", () => {
    expect(runs).toContain("Hours back every week");
    expect(runs.some((r) => r.includes("querySelectorAll"))).toBe(false);
    expect(runs.some((r) => r.includes("--accent"))).toBe(false);
    expect(runs.some((r) => r.includes("—"))).toBe(false);
  });

  it("leaves out comments and drops whitespace-only runs", () => {
    expect(htmlTextRuns("<p>a</p>\n  <!-- hidden note -->\n<p> b </p>")).toEqual(["a", "b"]);
  });
});

describe("htmlTokens", () => {
  it("reads double-quoted, single-quoted, unquoted and bare attributes, lowercasing names", () => {
    const [t] = htmlTokens(`<A HREF="#start" data-cta='primary' class=btn disabled>`);
    expect(t).toEqual({ kind: "open", name: "a", attrs: { href: "#start", "data-cta": "primary", class: "btn", disabled: "" }, void: false });
  });

  it("decodes entities in attribute values and marks void elements", () => {
    const [t] = htmlTokens(`<img src="a.png?x=1&amp;y=2" alt="Tern&#39;s logo">`);
    expect(t).toEqual({ kind: "open", name: "img", attrs: { src: "a.png?x=1&y=2", alt: "Tern's logo" }, void: true });
  });

  it("returns script and style bodies as raw text, unparsed", () => {
    const toks = htmlTokens("<style>a{background:url(//x/y.png)}</style><script>if (a < b) go('<p>');</script>");
    expect(toks).toEqual([
      { kind: "open", name: "style", attrs: {}, void: false },
      { kind: "raw", name: "style", text: "a{background:url(//x/y.png)}" },
      { kind: "close", name: "style" },
      { kind: "open", name: "script", attrs: {}, void: false },
      { kind: "raw", name: "script", text: "if (a < b) go('<p>');" },
      { kind: "close", name: "script" },
    ]);
  });
});

describe("excalidrawFrames", () => {
  const frames = excalidrawFrames(read("wireframe.excalidraw"));

  it("returns each frame with its width", () => {
    expect(frames?.map((f) => [f.name, f.width])).toEqual([
      ["Desktop 1440", 1440],
      ["Mobile 390", 390],
    ]);
  });

  it("lists the texts inside each frame top to bottom, unwrapped", () => {
    expect(frames?.[1].texts).toEqual([
      "Meeting notes that write themselves",
      "Start your free trial",
      "You can't listen and type at the same time",
      "Press record, put the phone down",
      "Hours back every week",
      "One workspace for the whole practice",
      "Try Tern on your next meeting",
    ]);
  });

  it("leaves out texts outside every frame", () => {
    const inside = frames?.flatMap((f) => f.texts) ?? [];
    expect(inside).toContain("Hours back every week");
    expect(inside.some((t) => t.includes("check the figure"))).toBe(false);
  });

  it("ignores deleted elements", () => {
    const json = JSON.stringify({
      elements: [
        { id: "f", type: "frame", x: 0, y: 0, width: 390, height: 800, name: "Mobile" },
        { id: "g", type: "frame", x: 500, y: 0, width: 1440, height: 800, name: "Old", isDeleted: true },
        { id: "t", type: "text", x: 10, y: 10, width: 100, height: 20, text: "Gone", isDeleted: true },
      ],
    });
    expect(excalidrawFrames(json)).toEqual([{ id: "f", name: "Mobile", x: 0, y: 0, width: 390, height: 800, texts: [] }]);
  });

  it("returns null for text that isn't Excalidraw JSON", () => {
    expect(excalidrawFrames("<svg></svg>")).toBeNull();
    expect(excalidrawFrames('{"type":"bar"}')).toBeNull();
  });
});

describe("excalidrawTexts", () => {
  it("returns every text element on the canvas, unwrapped", () => {
    const texts = excalidrawTexts(read("wireframe.excalidraw")) ?? [];
    expect(texts).toHaveLength(15);
    expect(texts).toContain("Hours back every week: check the figure against F8 before handoff");
  });
});
