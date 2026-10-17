/*
 * Owner, compiler and approval rules (grants included), persisted to <DATA_DIR>/policy/rules.json and merged after the
 * defaults. Every rule is validated against policy/v1 on the way in and on the way out: a corrupt or invalid file
 * throws instead of silently dropping rules, because a dropped deny relaxes. Defaults and locked rules can't be deleted.
 * On Vercel the disk is read-only except /tmp, so the file lives there (like the ledger). Every write announces the
 * `rules` topic on the server cache's bus, so open Permissions views refetch.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as z from "zod";
import { getServerCache } from "@/server/cache";
import { dataDir } from "@/server/paths";
import { TOPICS, type Bus } from "@/server/cache/bus";
import { DEFAULT_RULE_IDS, DEFAULT_RULES } from "./defaults";
import { issueLines, newRuleId, RuleSchema } from "./schema";
import type { Rule } from "./types";

export class RuleValidationError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = "RuleValidationError";
  }
}

export type RemoveResult = { ok: true } | { ok: false; reason: "default" | "locked" | "not_found" };

export function defaultPolicyDir(): string {
  if (process.env.POLICY_DIR) return process.env.POLICY_DIR;
  return process.env.VERCEL ? path.join(tmpdir(), "agent-teams", "policy") : path.join(dataDir(), "policy");
}

const FileSchema = z.object({ version: z.literal("policy/v1"), rules: z.array(RuleSchema) });

/** One write at a time per directory, so concurrent saves don't overwrite each other. */
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(dir: string, job: () => Promise<T>): Promise<T> {
  const next = (queues.get(dir) ?? Promise.resolve()).then(job, job);
  queues.set(
    dir,
    next.catch(() => undefined),
  );
  return next;
}

/** `bus` defaults to the server cache's (looked up at write time); tests pass their own. */
export function policyStore(dir: string = defaultPolicyDir(), bus?: Bus) {
  const file = path.join(dir, "rules.json");
  const announce = () => (bus ?? getServerCache().bus).emit(TOPICS.rules);

  async function stored(): Promise<Rule[]> {
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const parsed = FileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new RuleValidationError(`${file} is not valid policy/v1`, issueLines(parsed.error));
    return parsed.data.rules;
  }

  async function write(rules: Rule[]): Promise<void> {
    await mkdir(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ version: "policy/v1", rules }, null, 2)}\n`);
    await rename(tmp, file);
  }

  return {
    /** Defaults first, then saved rules in the order they were saved. */
    async list(): Promise<Rule[]> {
      return [...DEFAULT_RULES, ...(await stored())];
    },

    /** Validates every rule first (all or nothing), sets the mode, keeps free ids and replaces taken ones. */
    save(rules: Rule[], opts: { mode: "enforce" | "shadow" }): Promise<Rule[]> {
      return serialized(dir, async () => {
        const issues: string[] = [];
        rules.forEach((r, i) => {
          const parsed = RuleSchema.safeParse(r);
          if (!parsed.success) issues.push(...issueLines(parsed.error, ["rules", i]));
          else if (parsed.data.createdBy === "default") issues.push(`rules.${i}.createdBy: only built-in rules can be "default"`);
        });
        if (issues.length) throw new RuleValidationError("Some rules are not valid policy/v1", issues);

        const existing = await stored();
        const taken = new Set([...DEFAULT_RULE_IDS, ...existing.map((r) => r.id)]);
        const saved = rules.map((r) => {
          let id = r.id;
          while (taken.has(id)) id = newRuleId();
          taken.add(id);
          return { ...r, id, mode: opts.mode } as Rule;
        });
        await write([...existing, ...saved]);
        announce();
        return saved;
      });
    },

    remove(id: string): Promise<RemoveResult> {
      return serialized(dir, async (): Promise<RemoveResult> => {
        if (DEFAULT_RULE_IDS.has(id)) return { ok: false, reason: "default" };
        const existing = await stored();
        const rule = existing.find((r) => r.id === id);
        if (!rule) return { ok: false, reason: "not_found" };
        if (rule.locked) return { ok: false, reason: "locked" };
        await write(existing.filter((r) => r.id !== id));
        announce();
        return { ok: true };
      });
    },
  };
}

export type PolicyStore = ReturnType<typeof policyStore>;
