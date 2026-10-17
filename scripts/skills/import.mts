/*
 * Builds the skill library from the curation manifest (docs/design/team-setup.md §3b).
 *
 *   node scripts/skills/import.mts            # SKILLS_SRC=/tmp/agent-teams/skills-src by default; --keep-clones to keep them
 *
 * For each pick in skills/manifest.json: apply the selection criteria to the repo's snapshotted GitHub metadata,
 * shallow-fetch the repo at the pinned commit (sparse, blobs on demand), read the SKILL.md frontmatter, scan every
 * file, and either vendor the folder into skills/library/<id>/ (permissive license, under the size cap) or list it
 * link-only. Writes skills/index.json (a SkillIndex), skills/SOURCES.md and LICENSES/skills/<owner>/<repo>.txt.
 * Every timestamp comes from the manifest, so a rerun from a clean skills/ is byte-identical.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { SkillEntry, SkillIndex } from "../../src/lib/skills/types.ts";
import { scanFiles, type Finding, type ScanFile } from "./scan.mts";
import { CRITERIA, ManifestSchema, PERMISSIVE_LICENSES, SkillIndexSchema, type Manifest, type Pick, type RepoMeta } from "./schema.mts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SKILLS = path.join(ROOT, "skills");
const LIBRARY = path.join(SKILLS, "library");
const LICENSES = path.join(ROOT, "LICENSES", "skills");
const SRC = process.env.SKILLS_SRC ?? "/tmp/agent-teams/skills-src";
const KEEP = process.argv.includes("--keep-clones");

interface Excluded {
  id: string;
  repo: string;
  path: string;
  reason: string;
}

const manifest: Manifest = ManifestSchema.parse(JSON.parse(readFileSync(path.join(SKILLS, "manifest.json"), "utf8")));

const idOf = (p: Pick) => p.id ?? `${p.repo.split("/")[0]}/${p.path === "" ? p.repo.split("/")[1] : path.posix.basename(p.path)}`.toLowerCase();
const cloneDir = (repo: string, commit: string) => path.join(SRC, `${repo.replace("/", "__")}@${commit.slice(0, 12)}`);
const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

/** Why the repo fails the selection criteria, or null. */
function criteriaFailure(meta: RepoMeta): string | null {
  if (meta.fork) return "repo is a fork";
  if (meta.archived) return "repo is archived";
  if (!meta.official && meta.stars < CRITERIA.minStars) return `${meta.stars} stars (< ${CRITERIA.minStars}) and not an official publisher`;
  if (days(meta.pushedAt, manifest.curatedAt) > CRITERIA.maxAgeDays) return `last pushed ${meta.pushedAt}, over ${CRITERIA.maxAgeDays} days before curation`;
  return null;
}

function git(cwd: string, ...args: string[]) {
  execFileSync("git", args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
}

/** Shallow, sparse fetch of exactly the paths we need at one commit. */
function fetchRepo(repo: string, commit: string, paths: string[]): string {
  const dir = cloneDir(repo, commit);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  git(dir, "remote", "add", "origin", `https://github.com/${repo}.git`);
  git(dir, "config", "core.sparseCheckout", "true");
  writeFileSync(path.join(dir, ".git", "info", "sparse-checkout"), [...new Set(paths)].sort().map((p) => `/${p}`).join("\n") + "\n");
  git(dir, "fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", commit);
  git(dir, "-c", "advice.detachedHead=false", "checkout", "-q", "FETCH_HEAD");
  return dir;
}

/** Files of a skill folder, sorted, relative to it ("/"-separated). Symlinks are reported, never followed. */
function listFiles(dir: string, symlinks: string[], base = dir): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      if (name === ".git") return [];
      const p = path.join(dir, name);
      const rel = path.relative(base, p).split(path.sep).join("/");
      const st = lstatSync(p);
      if (st.isSymbolicLink()) {
        symlinks.push(rel);
        return [];
      }
      return st.isDirectory() ? listFiles(p, symlinks, base) : [rel];
    });
}

function frontmatter(skillMd: string): { name?: unknown; description?: unknown } | null {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(skillMd);
  if (!m) return null;
  const data: unknown = parseYaml(m[1]);
  return data && typeof data === "object" ? (data as { name?: unknown; description?: unknown }) : null;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const describeFindings = (fs: Finding[]) =>
  fs
    .slice(0, 5)
    .map((f) => `${f.rule} at ${f.file}:${f.line} ("${f.excerpt}")`)
    .join("; ") + (fs.length > 5 ? `; +${fs.length - 5} more` : "");

function main() {
  rmSync(LIBRARY, { recursive: true, force: true });
  rmSync(LICENSES, { recursive: true, force: true });

  const excluded: Excluded[] = [];
  const entries: SkillEntry[] = [];
  const why = new Map<string, string>();

  // 1. Selection criteria on the snapshotted metadata, before fetching anything.
  const eligible: Pick[] = [];
  for (const pick of manifest.skills) {
    const meta = manifest.repos[pick.repo];
    if (!meta) throw new Error(`manifest: no repos entry for ${pick.repo}`);
    if (pick.path === "" && !pick.include) throw new Error(`manifest: ${pick.repo} is a repo-root skill; list its files in "include"`);
    const failure = criteriaFailure(meta);
    if (failure) excluded.push({ id: idOf(pick), repo: pick.repo, path: pick.path, reason: failure });
    else eligible.push(pick);
  }

  // 2. One sparse fetch per repo@commit.
  const groups = new Map<string, Pick[]>();
  for (const p of eligible) groups.set(`${p.repo}@${p.commit}`, [...(groups.get(`${p.repo}@${p.commit}`) ?? []), p]);

  const licensed = new Set<string>();
  for (const picks of groups.values()) {
    const { repo, commit } = picks[0];
    const meta = manifest.repos[repo];
    const paths = picks.flatMap((p) => (p.include ? p.include.map((f) => path.posix.join(p.path, f)) : [`${p.path}/`]));
    for (const f of [meta.licenseFile, ...picks.map((p) => p.licenseFile)]) if (f) paths.push(f);
    process.stdout.write(`fetch ${repo}@${commit.slice(0, 12)} (${picks.length} skill${picks.length > 1 ? "s" : ""})\n`);
    const dir = fetchRepo(repo, commit, paths);

    for (const pick of picks) {
      const id = idOf(pick);
      const skillDir = path.join(dir, pick.path);
      const exclude = (reason: string) => excluded.push({ id, repo, path: pick.path, reason });
      if (!existsSync(path.join(skillDir, "SKILL.md"))) {
        exclude("no SKILL.md at the pinned commit");
        continue;
      }

      const symlinks: string[] = [];
      const files = pick.include ? [...pick.include].sort() : listFiles(skillDir, symlinks);
      const missing = files.filter((f) => !existsSync(path.join(skillDir, f)));
      if (missing.length) throw new Error(`${id}: include lists missing files ${missing.join(", ")}`);

      const scanInput: ScanFile[] = files.map((f) => {
        const p = path.join(skillDir, f);
        return { path: f, data: readFileSync(p), mode: lstatSync(p).mode };
      });
      const scan = scanFiles(scanInput);
      const findings: Finding[] = [
        ...scan.findings,
        ...symlinks.map((f) => ({ file: f, line: 1, rule: "package.symlink", excerpt: "symlink in skill folder" })),
      ];
      if (findings.length) {
        exclude(`scan: ${findings.length} finding${findings.length > 1 ? "s" : ""}: ${describeFindings(findings)}`);
        continue;
      }

      const fm = frontmatter(readFileSync(path.join(skillDir, "SKILL.md"), "utf8"));
      if (!fm || typeof fm.name !== "string" || typeof fm.description !== "string" || !fm.description.trim()) {
        exclude("SKILL.md frontmatter lacks a name or description");
        continue;
      }

      const license = pick.license ?? meta.license;
      const licenseFile = pick.licenseFile ?? meta.licenseFile;
      const bytes = scanInput.reduce((n, f) => n + f.data.length, 0);
      const notes: string[] = [];
      let vendored = true;
      if (!(PERMISSIVE_LICENSES as readonly string[]).includes(license)) {
        vendored = false;
        notes.push(`link-only: license ${license} is not on the permissive list`);
      } else if (!licenseFile || !existsSync(path.join(dir, licenseFile))) {
        vendored = false;
        notes.push("link-only: no license text to ship with it");
      } else if (bytes > CRITERIA.maxVendorBytes) {
        vendored = false;
        notes.push(`link-only: ${bytes} bytes, over the ${CRITERIA.maxVendorBytes}-byte vendoring cap`);
      }
      if (scan.executable) {
        const shown = scan.executables.slice(0, 6).join(", ");
        notes.push(`executable: ${shown}${scan.executables.length > 6 ? `, +${scan.executables.length - 6} more` : ""}`);
      }

      if (vendored) {
        for (const f of files) {
          const from = path.join(skillDir, f);
          const to = path.join(LIBRARY, id, f);
          mkdirSync(path.dirname(to), { recursive: true });
          copyFileSync(from, to);
          chmodSync(to, lstatSync(from).mode & 0o111 ? 0o755 : 0o644);
        }
        const licenseOut = path.join(LICENSES, `${repo}.txt`);
        if (!licensed.has(repo)) {
          mkdirSync(path.dirname(licenseOut), { recursive: true });
          copyFileSync(path.join(dir, licenseFile!), licenseOut);
          chmodSync(licenseOut, 0o644);
          licensed.add(repo);
        }
      }

      why.set(id, pick.why);
      entries.push({
        id,
        name: fm.name.trim(),
        description: oneLine(fm.description),
        archetypes: pick.archetypes,
        tags: pick.tags,
        source: {
          repo,
          path: pick.path,
          commit,
          url: `https://github.com/${repo}/tree/${commit}${pick.path ? `/${pick.path}` : ""}`,
          stars: meta.stars,
          publisher: meta.publisher,
          official: meta.official,
        },
        license,
        vendored,
        files: vendored ? files : [],
        scan: { at: manifest.curatedAt, findings: 0, ...(notes.length ? { notes: notes.join("; ") } : {}), executable: scan.executable },
        addedBy: "curation",
        addedAt: pick.addedAt ?? manifest.curatedAt,
      });
    }
    if (!KEEP) rmSync(dir, { recursive: true, force: true });
  }

  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const dupes = entries.map((e) => e.id).filter((id, i, all) => all.indexOf(id) !== i);
  if (dupes.length) throw new Error(`duplicate skill ids: ${dupes.join(", ")} (set "id" on one pick)`);

  const index: SkillIndex = SkillIndexSchema.parse({ version: 1, updatedAt: manifest.curatedAt, skills: entries });
  writeFileSync(path.join(SKILLS, "index.json"), JSON.stringify(index, null, 2) + "\n");
  writeFileSync(path.join(SKILLS, "SOURCES.md"), sourcesMd(index, excluded, why));

  const linkOnly = entries.filter((e) => !e.vendored).length;
  process.stdout.write(`\nindexed ${entries.length} (vendored ${entries.length - linkOnly}, link-only ${linkOnly}), excluded ${excluded.length}\n`);
  for (const e of excluded) process.stdout.write(`EXCLUDED ${e.id} (${e.repo}/${e.path}): ${e.reason}\n`);
}

const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function sourcesMd(index: SkillIndex, excluded: Excluded[], why: Map<string, string>): string {
  const vendored = index.skills.filter((s) => s.vendored).length;
  const lines = [
    "# Skill library sources",
    "",
    `Generated by \`node scripts/skills/import.mts\` from \`skills/manifest.json\` (curated ${manifest.curatedAt}); do not edit by hand.`,
    "Stars are the GitHub count at curation. Vendored license texts are in `LICENSES/skills/<owner>/<repo>.txt`.",
    `Criteria: permissive license to vendor (${PERMISSIVE_LICENSES.join(", ")}); official publisher or at least ${CRITERIA.minStars} stars;`,
    `not a fork; not archived; pushed within ${CRITERIA.maxAgeDays} days; a clean scan (scripts/skills/scan.ts).`,
    "",
    `## Indexed (${index.skills.length}: ${vendored} vendored, ${index.skills.length - vendored} link-only)`,
    "",
    "| id | repo@commit | publisher | license | stars | vendored | why it's in |",
    "|---|---|---|---|---|---|---|",
    ...index.skills.map((s) => {
      const at = `[${s.source.repo}@${s.source.commit.slice(0, 7)}](${s.source.url})`;
      const official = s.source.official ? " (official)" : "";
      const v = s.vendored ? "yes" : `no: ${cell(s.scan.notes?.match(/link-only: ([^;]*)/)?.[1] ?? "")}`;
      return `| \`${s.id}\` | ${at} | ${cell(s.source.publisher)}${official} | ${s.license} | ${thousands(s.source.stars)} | ${v} | ${cell(why.get(s.id) ?? "")} |`;
    }),
    "",
    `## Excluded at import (${excluded.length})`,
    "",
    ...(excluded.length
      ? ["| candidate | reason |", "|---|---|", ...excluded.map((e) => `| \`${e.id}\` (${e.repo}/${e.path}) | ${cell(e.reason)} |`)]
      : ["None."]),
    "",
    `## Rejected at curation (${manifest.rejected.length})`,
    "",
    ...(manifest.rejected.length
      ? ["| candidate | reason |", "|---|---|", ...manifest.rejected.map((r) => `| ${r.repo}${r.path ? `/${r.path}` : ""} | ${cell(r.reason)} |`)]
      : ["None."]),
    "",
  ];
  return lines.join("\n");
}

main();
