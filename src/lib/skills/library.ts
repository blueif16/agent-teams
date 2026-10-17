/*
 * The skill library on disk (docs/design/team-setup.md §3b): `skills/index.json` (a SkillIndex) and the vendored
 * files under `skills/library/<id>/`. The curator's import pipeline owns writing both; this module only reads.
 *
 * Server only. The skills dir is `skills/` under the app root, or SKILLS_DIR. The app's routes read it through
 * the server cache (src/server/cache/skills.ts), which keeps it in memory; this module reads disk every time.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SkillEntry, SkillIndex } from "./types";

export interface Library {
  index: SkillIndex;
  /** The skills dir: index.json and library/ live here. */
  dir: string;
  get(id: string): SkillEntry | undefined;
  /** A vendored skill's files, keyed by their path inside the skill folder (e.g. "SKILL.md"). */
  readFiles(id: string): Promise<Record<string, string>>;
}

export function skillsDir(): string {
  return process.env.SKILLS_DIR || path.join(process.cwd(), "skills");
}

/** Reads one file as UTF-8; rejects with ENOENT like readFile. The server cache passes one that remembers. */
export type ReadText = (file: string) => Promise<string>;

const readText: ReadText = (file) => readFile(file, "utf8");

async function readIndex(file: string, read: ReadText): Promise<SkillIndex> {
  let raw: string;
  try {
    raw = await read(file);
  } catch (e) {
    // Before the curator's first import there is no index: an empty library, not an error.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, updatedAt: "", skills: [] };
    throw e;
  }
  const index = JSON.parse(raw) as SkillIndex;
  if (index.version !== 1 || !Array.isArray(index.skills)) throw new Error(`${file}: unsupported skill index version ${index.version}`);
  return index;
}

export async function loadLibrary(dir = skillsDir(), read: ReadText = readText): Promise<Library> {
  const index = await readIndex(path.join(dir, "index.json"), read);
  const byId = new Map(index.skills.map((s) => [s.id, s]));
  const get = (id: string) => byId.get(id);

  async function readFiles(id: string): Promise<Record<string, string>> {
    const entry = get(id);
    if (!entry) throw new Error(`Unknown skill "${id}"`);
    if (!entry.vendored) throw new Error(`Skill "${id}" is not vendored: it is listed with a link only`);
    const root = path.resolve(dir, "library", id);
    const files: Record<string, string> = {};
    for (const rel of entry.files) {
      const file = path.resolve(root, rel);
      if (!file.startsWith(root + path.sep)) throw new Error(`Skill "${id}" lists a file outside its folder: ${rel}`);
      files[path.relative(root, file).split(path.sep).join("/")] = await read(file);
    }
    return files;
  }

  return { index, dir, get, readFiles };
}
