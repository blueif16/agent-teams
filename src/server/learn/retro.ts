/*
 * The retro (test-mode design §7b step 1): the PM's one model call over code-computed numbers and the owner's
 * feedback, validated line by line (each must cite evidence that exists), rendered by code into
 * projects/<pid>/state/retro.md. The numbers section is always written, even when every model line is dropped.
 */
import { z } from "zod";
import { evidenceProblem, type Evidence } from "./evidence";

export const RETRO_LINES = 12;
const SECTIONS = { wrong: "What went wrong", slow: "What was slow", well: "What went well" } as const;
type RetroSection = keyof typeof SECTIONS;
const KIND = /^[a-z0-9]+(?:-[a-z0-9]+){0,5}$/;

const Line = z.object({
  section: z.enum(["wrong", "slow", "well"]),
  text: z
    .string()
    .trim()
    .min(8)
    .max(300)
    .refine((s) => !/[\r\n]/.test(s), "one line"),
  evidence: z.array(z.string().trim().min(1).max(20)).max(8),
});
export type RetroLine = z.infer<typeof Line>;

export interface Retro {
  /** The kind of work, as a generic slug, when the model gave a valid one. */
  kind?: string;
  lines: RetroLine[];
  dropped: { reason: string; item: string }[];
}

export const isKind = (s: unknown): s is string => typeof s === "string" && s.length <= 48 && KIND.test(s);

export function validateRetro(raw: unknown, evidence: Map<string, Evidence>): Retro {
  const obj = (raw && typeof raw === "object" ? raw : {}) as { kind?: unknown; lines?: unknown };
  const lines: RetroLine[] = [];
  const dropped: Retro["dropped"] = [];
  for (const rawLine of Array.isArray(obj.lines) ? obj.lines : []) {
    const item = (JSON.stringify(rawLine) ?? "").slice(0, 200);
    const parsed = Line.safeParse(rawLine);
    if (!parsed.success) {
      dropped.push({ reason: `not a valid line: ${parsed.error.issues[0]?.message ?? "bad shape"}`, item });
      continue;
    }
    const bad = evidenceProblem(parsed.data.evidence, evidence);
    if (bad) {
      dropped.push({ reason: bad, item });
      continue;
    }
    if (lines.length >= RETRO_LINES) {
      dropped.push({ reason: `over the cap of ${RETRO_LINES} lines`, item });
      continue;
    }
    lines.push(parsed.data);
  }
  return { kind: isKind(obj.kind) ? obj.kind : undefined, lines, dropped };
}

export function renderRetro(pid: string, closedAt: string, table: Evidence[], retro: Pick<Retro, "lines">): string {
  const numbers = table.filter((e) => e.kind === "numbers");
  const cited = new Set(retro.lines.flatMap((l) => l.evidence));
  const shown = table.filter((e) => e.kind !== "numbers" && (cited.has(e.id) || e.kind === "failed" || e.kind === "order" || e.kind === "slow"));
  const section = (s: RetroSection) => {
    const mine = retro.lines.filter((l) => l.section === s);
    return [`## ${SECTIONS[s]}`, "", ...(mine.length ? mine.map((l) => `- ${l.text} [${l.evidence.join(", ")}]`) : ["_Nothing recorded._"]), ""];
  };
  return [
    `# Retro (${pid})`,
    "",
    `Closed ${closedAt}. The numbers are computed by code from the ledger and the PM's state files; every other line cites its evidence.`,
    "",
    "## Numbers",
    "",
    ...numbers.map((e) => `- ${e.id}: ${e.text}`),
    "",
    ...section("wrong"),
    ...section("slow"),
    ...section("well"),
    "## Evidence",
    "",
    ...(shown.length ? shown.map((e) => `- ${e.id} (${e.ref}): ${e.text}`) : ["_No feedback was given._"]),
    "",
  ].join("\n");
}

export const RETRO_SYSTEM = `You are the project manager writing the retro of a project that just closed. The company reads it so the next project of the same kind goes better, faster and cheaper.

<output_spec>
Answer with one JSON object and nothing else: no prose, no code fence.
{"kind": "<slug>", "lines": [{"section": "wrong" | "slow" | "well", "text": "<one sentence>", "evidence": ["<id>"]}]}
- kind: the kind of work in 1 to 4 generic lowercase words joined by hyphens, such as "product-launch-kit" or "market-research-report". Never a client, product or competitor name.
- lines: 3 to 10 lines. "wrong" is what went wrong, "slow" is what took longer than it should have, "well" is what to repeat.
</output_spec>

<the_bar>
Required for every line:
1. evidence lists at least one id from EVIDENCE, exactly as written there (F1, O2, S1, N1, t3, J4, D-002). A line without a listed id is thrown away.
2. text names a cause or a pattern someone can act on next time ("the copy went out before anyone checked it against the facts sheet"), not a restatement of a number ("there was one failed item").
3. Every failed rubric item (F*) and every 🔁 order (O*) is explained by at least one "wrong" line, and every slow phase (S*) by a "slow" line.
4. Numbers come only from EVIDENCE. Do not compute or invent any.
Must not: write a line that no evidence supports; copy an evidence line word for word; add keys other than kind and lines.
</the_bar>

<self_check>
Before answering, check each line against 1 to 4 and fix or drop any that fails. If EVIDENCE supports nothing worth saying, answer {"kind": "<slug>", "lines": []}.
</self_check>`;

export function retroUser(ctx: { pid: string; leadId: string; projectName: string; goal: string; evidence: string }): string {
  return [
    "step: retro",
    `agent: ${ctx.leadId}`,
    `project: ${ctx.pid}`,
    "",
    `Project: ${ctx.projectName}`,
    `Goal: ${ctx.goal || "not set"}`,
    "",
    "EVIDENCE (id: what happened)",
    ctx.evidence,
    "",
    "Answer with the JSON object only, every line citing EVIDENCE ids.",
  ].join("\n");
}
