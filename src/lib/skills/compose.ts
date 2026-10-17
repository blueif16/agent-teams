/*
 * Compositions: an archetype plus the library skills chosen for one role (src/lib/skills/types.ts). Archetypes and
 * the skill library are the only primitives; nothing ships fixed default skills per archetype.
 *
 * compose() searches the library once per qualification (the role's needs), local-first through findSkill: a library
 * hit adds its best usable skill; a miss comes back in `pending` with vetted web candidates for the owner to approve
 * (on the launch card), and is never added here.
 *
 * Seam, not built yet: compositions "from history" (`source: "history"`, `basedOn`) adapt a past composition that
 * worked for a similar role, read from the vault (§8b). compose() always builds a fresh one (`source: "orchestrator"`).
 *
 * materializeSkills() turns a composition into the files map a Deep Agent's `skills: ["/skills/"]` loads:
 * `/skills/<name>/SKILL.md` plus the skill's other files, with an empty memory. Server only.
 */
import { randomUUID } from "node:crypto";
import type { Archetype } from "../policy/types";
import type { FindSkillResult } from "./find";
import type { Library } from "./library";
import type { Composition, SkillEntry } from "./types";

export interface ComposeDeps {
  library: Library;
  /** findSkill with its search, research and GitHub deps bound. */
  find: (need: string, ctx: { archetype?: Archetype; qualifications?: string[] }) => Promise<FindSkillResult>;
  /** Q4: a few skills, not a pile. Default 5. */
  maxSkills?: number;
  now?: () => Date;
}

export interface ComposeResult {
  composition: Composition;
  /** Needs the library missed, with the web candidates found for each; nothing here is installed. */
  pending: { need: string; result: Extract<FindSkillResult, { source: "web" }> }[];
}

/** A skill an agent can load today: copied in, scan clean, and no scripts (they wait for a sandbox, tier T7). */
const loadable = (e: SkillEntry) => e.vendored && e.scan.findings === 0 && !e.scan.executable;

export async function compose(
  { archetype, role, qualifications }: { archetype: Archetype; role: string; qualifications: string[] },
  deps: ComposeDeps,
): Promise<ComposeResult> {
  const max = deps.maxSkills ?? 5;
  const needs = qualifications.length ? qualifications : [role];
  const skills: string[] = [];
  const pending: ComposeResult["pending"] = [];
  for (const need of needs) {
    if (skills.length >= max) break;
    const result = await deps.find(need, { archetype, qualifications });
    if (result.source === "web") {
      pending.push({ need, result });
      continue;
    }
    const pick = result.hits.find((h) => loadable(h.entry) && !skills.includes(h.entry.id));
    if (pick) skills.push(pick.entry.id);
  }
  return {
    composition: {
      id: randomUUID(),
      archetype,
      skills,
      role,
      qualifications,
      source: "orchestrator",
      createdAt: (deps.now?.() ?? new Date()).toISOString(),
    },
    pending,
  };
}

const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The folder Deep Agents expects: the SKILL.md frontmatter `name` (it must equal the folder), else the id's last part. */
function folderOf(entry: SkillEntry, skillMd: string): string {
  const front = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const name = front.match(/^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m)?.[1];
  if (name && name.length <= 64 && SKILL_NAME.test(name)) return name;
  return entry.id.split("/").pop()!;
}

export async function materializeSkills(composition: Composition, library: Library): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const folders = new Map<string, string>();
  for (const id of composition.skills) {
    const entry = library.get(id);
    if (!entry) throw new Error(`Unknown skill "${id}"`);
    if (!entry.vendored) throw new Error(`Skill "${id}" is not vendored: it is listed with a link only`);
    if (entry.scan.findings > 0) throw new Error(`Skill "${id}" failed its scan (${entry.scan.findings} findings)`);
    if (entry.scan.executable) throw new Error(`Skill "${id}" is executable: it waits for a sandbox (tier T7)`);
    const files = await library.readFiles(id);
    if (files["SKILL.md"] === undefined) throw new Error(`Skill "${id}" has no SKILL.md`);
    const folder = folderOf(entry, files["SKILL.md"]);
    // Deep Agents keys skills by name, so a second one with the same name would silently replace the first.
    const taken = folders.get(folder);
    if (taken) throw new Error(`Skills "${taken}" and "${id}" both load as /skills/${folder}/`);
    folders.set(folder, id);
    for (const [rel, content] of Object.entries(files)) out[`/skills/${folder}/${rel}`] = content;
  }
  return out;
}
