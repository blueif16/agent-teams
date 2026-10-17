import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { convertGoRegex, importGitleaks, labelFor, parseToml, renderModule } from "./import-gitleaks.mts";

const VENDORED = new URL("./vendor/gitleaks.toml", import.meta.url);
const GENERATED = new URL("../../src/lib/policy/detectors/gitleaks.gen.ts", import.meta.url);

describe("convertGoRegex (RE2 → JS port fixes)", () => {
  it("strips a leading (?i) and sets the i flag", () => {
    expect(convertGoRegex("(?i)abc")).toEqual({ source: "abc", flags: "i" });
  });

  it("scopes a mid-pattern (?i) to the rest of its group", () => {
    expect(convertGoRegex("\\b(p8e-(?i)[a-z0-9]{32})x")).toEqual({ source: "\\b(p8e-(?i:[a-z0-9]{32}))x", flags: "" });
  });

  it("scopes a mid-pattern (?i) across every later alternative of its group", () => {
    // Go: the flag holds to the end of the group, so it covers B and C, and A stays case-sensitive.
    expect(convertGoRegex('(?:"A(?i)B|C)D')).toEqual({ source: '(?:"A(?i:B)|(?i:C))D', flags: "" });
  });

  it("scopes a mid-pattern (?i) at top level to the end of the pattern", () => {
    expect(convertGoRegex("^/Users/(?i)[a-z]+$")).toEqual({ source: "^/Users/(?i:[a-z]+$)", flags: "" });
  });

  it("drops a redundant mid-pattern (?i) when the whole pattern is already case-insensitive", () => {
    expect(convertGoRegex("(?i)\\b(pscale_(?i)[a-z]{3})")).toEqual({ source: "\\b(pscale_[a-z]{3})", flags: "i" });
  });

  it("drops a second (?i) inside a group the first one already covers", () => {
    // curl-auth-header: (?:"(?i)A"|'(?i)B')
    expect(convertGoRegex(`(?:"(?i)A"|'(?i)B')`)).toEqual({ source: `(?:"(?i:A")|(?i:'B'))`, flags: "" });
  });

  it("rewrites \\z to $ and \\A to ^", () => {
    expect(convertGoRegex("\\Asha256~[\\w-]{43}(?:[^\\w-]|\\z)")).toEqual({ source: "^sha256~[\\w-]{43}(?:[^\\w-]|$)", flags: "" });
  });

  it("leaves an escaped backslash followed by z alone", () => {
    expect(convertGoRegex("a\\\\z")).toEqual({ source: "a\\\\z", flags: "" });
  });

  it("rewrites (?P<name> to (?<name>", () => {
    expect(convertGoRegex("(?P<alg>aGJH)|(?P<typ>dHlw)")).toEqual({ source: "(?<alg>aGJH)|(?<typ>dHlw)", flags: "" });
  });

  it("expands POSIX classes inside brackets", () => {
    expect(convertGoRegex("pat[[:alnum:]]{14}")).toEqual({ source: "pat[a-zA-Z0-9]{14}", flags: "" });
  });

  it("does not treat an escaped paren as a group", () => {
    expect(convertGoRegex("\\((?i)ab\\)c")).toEqual({ source: "\\((?i:ab\\)c)", flags: "" });
  });

  it("the converted patterns behave like RE2 on case", () => {
    const { source, flags } = convertGoRegex('(?:"A(?i)B|C)D');
    const re = new RegExp(`^${source}$`, flags);
    expect(re.test('"AbD')).toBe(true);
    expect(re.test("cD")).toBe(true);
    expect(re.test('"abD')).toBe(false);
  });
});

describe("parseToml (the subset gitleaks.toml uses)", () => {
  const sample = [
    "# comment",
    'title = "gitleaks config"',
    "[allowlist]",
    'description = "global"',
    "regexes = [",
    "    '''^\\$\\{x\\}$''',",
    "]",
    'stopwords = ["abc", "d\\"e"]',
    "",
    "[[rules]]",
    'id = "r1"',
    "regex = '''(?i)ab'''",
    "entropy = 3.5",
    "secretGroup = 2",
    'keywords = ["x",]',
    "[[rules.allowlists]]",
    'regexTarget = "match"',
    "regexes = ['''z''']",
    "",
    "[[rules]]",
    'id = "r2"',
    "path = '''\\.php$'''",
  ].join("\n");

  it("parses tables, arrays of tables, nested arrays of tables, strings, numbers and arrays", () => {
    expect(parseToml(sample)).toEqual({
      title: "gitleaks config",
      allowlist: { description: "global", regexes: ["^\\$\\{x\\}$"], stopwords: ["abc", 'd"e'] },
      rules: [
        { id: "r1", regex: "(?i)ab", entropy: 3.5, secretGroup: 2, keywords: ["x"], allowlists: [{ regexTarget: "match", regexes: ["z"] }] },
        { id: "r2", path: "\\.php$" },
      ],
    });
  });
});

describe("labelFor", () => {
  it("labels a rule by its provider", () => {
    expect(labelFor("aws-access-token")).toBe("secret.aws");
    expect(labelFor("github-pat")).toBe("secret.github");
    expect(labelFor("generic-api-key")).toBe("secret.generic");
    expect(labelFor("jwt")).toBe("secret.jwt");
  });

  it("keeps multi-word providers and kinds whole", () => {
    expect(labelFor("private-key")).toBe("secret.private_key");
    expect(labelFor("new-relic-user-api-key")).toBe("secret.new_relic");
    expect(labelFor("curl-auth-user")).toBe("secret.credential");
  });
});

describe("importGitleaks on the vendored gitleaks.toml", () => {
  const result = importGitleaks(readFileSync(VENDORED, "utf8"));

  it("accounts for all 222 upstream rules", () => {
    expect(result.rules.length + result.dropped.length).toBe(222);
  });

  it("drops the rules that only fire on a file path (no path in free text)", () => {
    const pathScoped = result.dropped.filter((d) => d.reason.startsWith("path"));
    expect(pathScoped.map((d) => d.id).sort()).toEqual(
      ["freemius-secret-key", "hashicorp-tf-password", "kubernetes-secret-yaml", "nuget-config-password", "pkcs12-file"].sort(),
    );
  });

  it("every vendored rule compiles as a JS RegExp with indices", () => {
    for (const r of result.rules) {
      expect(() => new RegExp(r.source, `${r.flags}dg`), r.id).not.toThrow();
      expect(r.label, r.id).toMatch(/^secret\.[a-z0-9_]+$/);
    }
  });

  it("keeps every leading (?i) as the i flag, not as pattern text", () => {
    for (const r of result.rules) expect(r.source, r.id).not.toContain("(?i)");
    expect(result.rules.filter((r) => r.flags.includes("i")).length).toBeGreaterThanOrEqual(100);
  });

  it("drops path-only allowlists and keeps the regex and stopword ones", () => {
    const generic = result.rules.find((r) => r.id === "generic-api-key")!;
    expect(generic.allow?.some((a) => a.stopwords?.includes("abstract"))).toBe(true);
    expect(generic.allow?.some((a) => a.target === "line")).toBe(true);
    const ghp = result.rules.find((r) => r.id === "github-pat")!;
    expect(ghp.allow).toBeUndefined();
  });

  it("the committed gitleaks.gen.ts is exactly what the script generates (no drift)", () => {
    expect(readFileSync(GENERATED, "utf8")).toBe(renderModule(result));
  });
});
