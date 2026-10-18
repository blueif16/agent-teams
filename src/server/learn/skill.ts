/*
 * Skill tuning (test-mode design §7b step 3): edits to an agent's OWN copies of its skills
 * (`agents/<id>/skills/<folder>/SKILL.md`, materialized at hire), never the shared library. An edit is kept only when
 * it cites a failed rubric item or a 🔁 order on this agent's work, names one of its own copies, stays under the size
 * caps and leaves the frontmatter alone. An edit either appends under "## Lessons from past projects" or replaces one
 * exact, unique passage.
 */
import { z } from "zod";
import { evidenceProblem, type Evidence } from "./evidence";

/** Edits kept per agent per close. */
export const SKILL_EDIT_CAP = 2;
/** Characters per edit (old or new), and added plus removed per agent per close. */
export const EDIT_CHARS = 600;
export const CLOSE_CHARS = 1200;
export const LESSONS = "## Lessons from past projects";

const Edit = z.object({
  skill: z.string().trim().min(1).max(64),
  old: z.string().default(""),
  new: z.string().trim().min(8),
  evidence: z.array(z.string().trim().min(1).max(20)).max(8),
});
export type SkillEdit = z.infer<typeof Edit>;

export interface EditDrop {
  reason: string;
  item: string;
}

/** Where the frontmatter ends (the index just past its closing ---), or 0 when there is none. */
function frontmatterEnd(md: string): number {
  const m = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(md);
  return m ? m[0].length : 0;
}

const brief = (raw: unknown) => {
  const s = JSON.stringify(raw) ?? String(raw);
  return s.length > 200 ? `${s.slice(0, 199)}…` : s;
};

/**
 * Validates and applies the model's edits to the agent's copies. `pointers`: the evidence ids (F*, and O* for 🔁)
 * about this agent's work, the only ones that can justify a skill edit. Returns the new content per folder that changed.
 */
export function tuneSkills(
  raw: unknown,
  ctx: { agentId: string; copies: Map<string, string>; evidence: Map<string, Evidence>; pointers: Set<string> },
): { files: Map<string, string>; edits: SkillEdit[]; dropped: EditDrop[] } {
  const list = Array.isArray((raw as { edits?: unknown })?.edits) ? ((raw as { edits: unknown[] }).edits as unknown[]) : [];
  const files = new Map<string, string>();
  const edits: SkillEdit[] = [];
  const dropped: EditDrop[] = [];
  let chars = 0;

  for (const rawEdit of list) {
    const drop = (reason: string) => dropped.push({ reason, item: brief(rawEdit) });
    const parsed = Edit.safeParse(rawEdit);
    if (!parsed.success) {
      drop(`not a valid edit: ${parsed.error.issues[0]?.message ?? "bad shape"}`);
      continue;
    }
    const e = parsed.data;
    const bad = evidenceProblem(e.evidence, ctx.evidence);
    if (bad) {
      drop(bad);
      continue;
    }
    if (!e.evidence.some((id) => ctx.pointers.has(id))) {
      drop(`no failed item or 🔁 note on ${ctx.agentId}'s work points at this edit`);
      continue;
    }
    const current = files.get(e.skill) ?? ctx.copies.get(e.skill);
    if (current === undefined) {
      drop(`"${e.skill.slice(0, 40)}" is not one of ${ctx.agentId}'s own copies`);
      continue;
    }
    const size = e.new.length + e.old.length;
    if (e.new.length > EDIT_CHARS || e.old.length > EDIT_CHARS || chars + size > CLOSE_CHARS) {
      drop(`over the size cap (${EDIT_CHARS} characters an edit, ${CLOSE_CHARS} a close)`);
      continue;
    }
    let next: string;
    if (e.old) {
      const at = current.indexOf(e.old);
      if (at === -1) {
        drop("the text to replace isn't in the skill");
        continue;
      }
      if (current.indexOf(e.old, at + 1) !== -1) {
        drop("the text to replace appears more than once");
        continue;
      }
      if (at < frontmatterEnd(current)) {
        drop("the edit touches the frontmatter");
        continue;
      }
      next = current.slice(0, at) + e.new + current.slice(at + e.old.length);
    } else {
      const body = current.trimEnd();
      next = body.includes(LESSONS) ? `${body}\n${e.new}\n` : `${body}\n\n${LESSONS}\n\n${e.new}\n`;
    }
    if (edits.length >= SKILL_EDIT_CAP) {
      drop(`over the cap of ${SKILL_EDIT_CAP} skill edits per close`);
      continue;
    }
    chars += size;
    files.set(e.skill, next);
    edits.push(e);
  }
  return { files, edits, dropped };
}

export function skillSystem(agent: { name: string; archetype: string }): string {
  return `You are ${agent.name}, a ${agent.archetype}, tuning your own copies of your skills after a project closed. A skill is a procedure you follow. Edit one only where the owner's feedback on your work shows the procedure has a gap: a failed rubric item (F*) or a 🔁 redo (O*) listed under YOUR FEEDBACK.

<output_spec>
Answer with one JSON object and nothing else: no prose, no code fence.
{"edits": [{"skill": "<a folder name from SKILLS>", "old": "<exact text to replace, copied from the skill, or an empty string to append>", "new": "<the new text>", "evidence": ["<F or O id>"]}]}
At most ${SKILL_EDIT_CAP} edits, each "new" under 400 characters. Answer {"edits": []} when no skill has a gap the feedback points at.
</output_spec>

<the_bar>
Required for every edit:
1. evidence cites at least one F* or O* id from YOUR FEEDBACK.
2. new is the step or check the procedure was missing, written as an instruction in the skill's own style and general enough for any client. With an empty old it is appended under "Lessons from past projects".
3. old, when not empty, appears exactly once in the skill, below the frontmatter (the lines between the two ---).
Must not: include any client name, product name, competitor, price or figure from the project; rewrite parts the feedback doesn't touch; edit the frontmatter.
</the_bar>

<self_check>
Before answering, check each edit against 1 to 3 and the must-nots, and drop any edit that fails.
</self_check>`;
}

export function skillUser(ctx: { agentId: string; feedback: string; skills: Map<string, string> }): string {
  const skills = [...ctx.skills].map(([folder, md]) => `<skill folder="${folder}">\n${md.length > 4000 ? `${md.slice(0, 4000)}\n…(cut)` : md}\n</skill>`);
  return [
    "step: skill",
    `agent: ${ctx.agentId}`,
    "",
    "YOUR FEEDBACK (id: what happened)",
    ctx.feedback,
    "",
    "SKILLS (your own copies)",
    ...skills,
    "",
    `Answer with the JSON object only: at most ${SKILL_EDIT_CAP} edits, each citing an F or O id from YOUR FEEDBACK.`,
  ].join("\n");
}
