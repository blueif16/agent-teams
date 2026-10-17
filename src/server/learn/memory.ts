/*
 * Dream ops on an agent's MEMORY.md (team-setup §5): the model proposes add / revise / remove, each citing evidence;
 * code validates every op (the schema, the evidence ids, the item it names, duplicates, the per-run cap and the
 * ≤ 25% removal limit) and applies the ones that pass. Only the Mistakes and Best approaches sections are edited;
 * everything else in the file (its header, any other section) is kept as it is. No "Done" items (Q7).
 */
import { z } from "zod";
import { evidenceProblem, type Evidence } from "./evidence";

/** Ops applied per agent per close; the rest are dropped and listed. */
export const DREAM_CAP = 5;
/** At most this share of the existing items may be removed in one dream. */
export const REMOVE_SHARE = 0.25;

export const SECTIONS = ["Mistakes", "Best approaches"] as const;
type Section = (typeof SECTIONS)[number];
const PREFIX: Record<Section, string> = { Mistakes: "M", "Best approaches": "B" };
const PLACEHOLDER = "_None recorded yet._";

export interface MemoryItem {
  /** M1, M2… for Mistakes; B1… for Best approaches, top to bottom. */
  id: string;
  section: Section;
  text: string;
  /** Index into the file's lines. */
  line: number;
}

/** The items of the editable sections, numbered by code so ops can name them. */
export function parseMemory(md: string): MemoryItem[] {
  const items: MemoryItem[] = [];
  let section: Section | null = null;
  const counts: Record<Section, number> = { Mistakes: 0, "Best approaches": 0 };
  md.split("\n").forEach((raw, line) => {
    const heading = /^##\s+(.+?)\s*$/.exec(raw);
    if (heading) {
      section = (SECTIONS as readonly string[]).includes(heading[1]) ? (heading[1] as Section) : null;
      return;
    }
    const item = /^-\s+(.+)$/.exec(raw);
    if (section && item) items.push({ id: `${PREFIX[section]}${++counts[section]}`, section, text: item[1].trim(), line });
  });
  return items;
}

const Text = z
  .string()
  .trim()
  .min(8)
  .max(300)
  .refine((s) => !/[\r\n]/.test(s), "one line");
const Tag = z.enum(["observed", "inferred", "stated"]).default("observed");
const Ids = z.array(z.string().trim().min(1).max(20)).max(8);
const Op = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), section: z.enum(SECTIONS), text: Text, tag: Tag, evidence: Ids }),
  z.object({ op: z.literal("revise"), item: z.string().trim(), text: Text, tag: Tag, evidence: Ids }),
  z.object({ op: z.literal("remove"), item: z.string().trim(), evidence: Ids }),
]);
export type DreamOp = z.infer<typeof Op>;

export interface OpDrop {
  reason: string;
  item: string;
}

/** Text compared for duplicates: no provenance suffix, case, punctuation or spacing. */
const key = (s: string) =>
  s
    .replace(/\s*\([^()]*\)\s*$/, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const brief = (raw: unknown) => {
  const s = JSON.stringify(raw) ?? String(raw);
  return s.length > 200 ? `${s.slice(0, 199)}…` : s;
};

/** Validates the model's ops in order; the first DREAM_CAP that pass are kept, everything else is dropped with a reason. */
export function validateOps(raw: unknown, items: MemoryItem[], evidence: Map<string, Evidence>): { ops: DreamOp[]; dropped: OpDrop[] } {
  const list = Array.isArray((raw as { ops?: unknown })?.ops) ? ((raw as { ops: unknown[] }).ops as unknown[]) : [];
  const ops: DreamOp[] = [];
  const dropped: OpDrop[] = [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const touched = new Set<string>();
  const texts = new Set(items.map((i) => key(i.text)));
  const removable = Math.floor(items.length * REMOVE_SHARE);
  let removes = 0;

  for (const rawOp of list) {
    const drop = (reason: string) => dropped.push({ reason, item: brief(rawOp) });
    const parsed = Op.safeParse(rawOp);
    if (!parsed.success) {
      drop(`not a valid op: ${parsed.error.issues[0]?.message ?? "bad shape"}`);
      continue;
    }
    const op = parsed.data;
    const bad = evidenceProblem(op.evidence, evidence);
    if (bad) {
      drop(bad);
      continue;
    }
    if (op.op !== "add") {
      if (!byId.has(op.item)) {
        drop(`no memory item ${op.item}`);
        continue;
      }
      if (touched.has(op.item)) {
        drop(`${op.item} already has an op in this dream`);
        continue;
      }
    }
    if (op.op !== "remove" && texts.has(key(op.text))) {
      drop("duplicate of an item already in memory");
      continue;
    }
    if (ops.length >= DREAM_CAP) {
      drop(`over the cap of ${DREAM_CAP} ops per dream`);
      continue;
    }
    if (op.op === "remove" && removes >= removable) {
      drop(`over the removal cap (${removable} of ${items.length} items per dream)`);
      continue;
    }
    if (op.op !== "add") touched.add(op.item);
    if (op.op !== "remove") texts.add(key(op.text));
    if (op.op === "remove") removes++;
    ops.push(op);
  }
  return { ops, dropped };
}

/** MEMORY.md with the ops applied: new items newest first in their section, each with its tag, date and sources. */
export function applyOps(md: string, ops: DreamOp[], items: MemoryItem[], meta: { date: string; refs: (ids: string[]) => string[] }): string {
  const lines = md.split("\n");
  const byId = new Map(items.map((i) => [i.id, i]));
  const render = (op: Extract<DreamOp, { text: string }>) => `- ${op.text} (${op.tag} · ${meta.date} · ${meta.refs(op.evidence).slice(0, 3).join(", ")})`;

  const replaced = new Map<number, string | null>();
  for (const op of ops) {
    if (op.op === "revise") replaced.set(byId.get(op.item)!.line, render(op));
    if (op.op === "remove") replaced.set(byId.get(op.item)!.line, null);
  }
  let out = lines.flatMap((l, i) => (replaced.has(i) ? (replaced.get(i) === null ? [] : [replaced.get(i)!]) : [l]));

  for (const section of SECTIONS) {
    const added = ops.filter((o): o is Extract<DreamOp, { op: "add" }> => o.op === "add" && o.section === section).map(render);
    let at = out.findIndex((l) => new RegExp(`^##\\s+${section}\\s*$`).test(l));
    if (at === -1) {
      if (!added.length) continue;
      out = [...trimEnd(out), "", `## ${section}`, ""];
      at = out.length - 2;
    }
    // The section's body: up to the next heading.
    let end = out.findIndex((l, i) => i > at && /^#{1,2}\s/.test(l));
    if (end === -1) end = out.length;
    const body = out.slice(at + 1, end);
    const kept = body.filter((l) => l.trim() && l.trim() !== PLACEHOLDER);
    const itemsNow = [...added, ...kept];
    const rebuilt = ["", ...(itemsNow.length ? itemsNow : [PLACEHOLDER]), ""];
    out = [...out.slice(0, at + 1), ...rebuilt, ...out.slice(end)];
  }
  return `${trimEnd(out).join("\n")}\n`;
}

const trimEnd = (lines: string[]) => {
  const out = [...lines];
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
};

export function dreamSystem(agent: { name: string; archetype: string }): string {
  return `You are ${agent.name}, a ${agent.archetype} at the company, consolidating your memory after a project closed ("dreaming"). MEMORY.md is what you carry into every future project: the mistakes to avoid and the approaches that work. It must teach you how to do the work better, never what this one client's facts were.

<output_spec>
Answer with one JSON object and nothing else: no prose, no code fence.
{"ops": [
  {"op": "add", "section": "Mistakes" | "Best approaches", "text": "<one sentence>", "tag": "observed" | "inferred" | "stated", "evidence": ["<id>"]},
  {"op": "revise", "item": "<an item id such as M2 or B1>", "text": "<the better sentence>", "tag": "observed" | "inferred" | "stated", "evidence": ["<id>"]},
  {"op": "remove", "item": "<an item id>", "evidence": ["<id>"]}
]}
At most ${DREAM_CAP} ops. Answer {"ops": []} when the project taught nothing new.
</output_spec>

<the_bar>
Required for every op:
1. evidence lists at least one id from EVIDENCE, exactly as written there. An op without one is dropped.
2. text is a lesson that carries over to the next project for any client: a habit, a check or an approach in your own work ("check every number in the copy against the facts sheet before posting it"). tag: "observed" when the evidence shows it happened, "stated" when the owner said it (a note on an O* order), "inferred" when it is your conclusion from the evidence.
3. Use revise, not add, when an item in CURRENT MEMORY already says nearly the same thing. Remove an item only when the evidence shows it is wrong.
Must not: include any client name, product name, competitor, price, figure or date from the project; repeat an item already in memory; record task progress or what was done (there is no "Done" list); write instructions for other agents.
</the_bar>

<self_check>
Before answering, check each op against 1 to 3 and the must-nots, and drop any op that fails.
</self_check>`;
}

export function dreamUser(ctx: { agentId: string; role: string; items: MemoryItem[]; evidence: string; retro: string }): string {
  return [
    "step: dream",
    `agent: ${ctx.agentId}`,
    `role: ${ctx.role}`,
    "",
    "CURRENT MEMORY (item id: text)",
    ctx.items.length ? ctx.items.map((i) => `${i.id} (${i.section}): ${i.text}`).join("\n") : "(empty)",
    "",
    "EVIDENCE (id: what happened)",
    ctx.evidence,
    "",
    "THE PM'S RETRO",
    ctx.retro || "(none)",
    "",
    `Answer with the JSON object only: at most ${DREAM_CAP} ops, each citing EVIDENCE ids.`,
  ].join("\n");
}
