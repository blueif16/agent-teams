import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/*
 * Every GET a component makes goes through useCached/prefetch (src/lib/client-cache.ts), so nothing the owner
 * has seen once shows a loading screen again (DECISIONS.md → Product). This parses every component and every
 * page or layout under src/app, and fails on each fetch() that isn't a write: a POST, PUT, PATCH or DELETE,
 * judged by a literal `method:` in the call's options.
 */
const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Files exempt from the rule. Empty: every component GET goes through the cache. */
const ALLOWED = new Set<string>([]);

const isFetch = (e: ts.Expression) =>
  (ts.isIdentifier(e) && e.text === "fetch") ||
  (ts.isPropertyAccessExpression(e) && e.name.text === "fetch" && ts.isIdentifier(e.expression) && ["window", "globalThis", "self"].includes(e.expression.text));

function isWrite(options: ts.Expression | undefined): boolean {
  if (!options || !ts.isObjectLiteralExpression(options)) return false;
  return options.properties.some(
    (p) =>
      ts.isPropertyAssignment(p) &&
      (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
      p.name.text === "method" &&
      ts.isStringLiteralLike(p.initializer) &&
      WRITES.has(p.initializer.text.toUpperCase()),
  );
}

/** `file:line` for each fetch() in `source` that isn't a write. */
function rawGets(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && isFetch(node.expression) && !isWrite(node.arguments[1])) {
      found.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const tsxUnder = (dir: string) =>
  readdirSync(path.join(process.cwd(), dir), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => path.posix.join(dir, f.split(path.sep).join("/")))
    .sort();

describe("component GETs go through the client cache", () => {
  it("finds a GET fetch, with or without options, and lets writes through", () => {
    const source = [
      'fetch("/api/a");',
      'fetch("/api/b", { headers: {} });',
      'await window.fetch(`/api/c`, { method: "GET" });',
      'fetch("/api/d", { method: "POST", body: "{}" });',
      'fetch(`/api/e/${id}`, { method: "DELETE" });',
      "// fetch('/api/in-a-comment')",
      'const s = "fetch(/api/in-a-string)";',
      "prefetch(skills);",
    ].join("\n");
    expect(rawGets("x.tsx", source)).toEqual(["x.tsx:1", "x.tsx:2", "x.tsx:3"]);
  });

  it("no component or page GETs with a raw fetch()", () => {
    const files = [...tsxUnder("src/components"), ...tsxUnder("src/app")];
    expect(files).toContain("src/components/Skills.tsx");
    expect(files).toContain("src/app/page.tsx");

    const raw = files.filter((f) => !ALLOWED.has(f)).flatMap((f) => rawGets(f, readFileSync(path.join(process.cwd(), f), "utf8")));

    expect(raw, "Use useCached or prefetch from src/lib/client-cache.ts for these GETs").toEqual([]);
  });
});
