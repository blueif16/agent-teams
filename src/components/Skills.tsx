import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, BadgeCheck, ExternalLink, FileText, Puzzle, Search, ShieldAlert, ShieldCheck, SquareTerminal, Star, X } from "lucide-react";
import { cache, useCached, type Resource } from "@/lib/client-cache";
import type { Archetype } from "@/lib/policy/types";
import type { ArchetypeDef, SkillEntry, SkillHit } from "@/lib/skills/types";
import { Markdown } from "./Markdown";
import { SPRING } from "./ui";

/*
 * The skill library (design §3b): vetted SKILL.md packages experts load at hire. A Skills tab in the workspace,
 * opened from the rail: local search over GET /api/skills, archetype chips, one row per skill, and a detail view
 * with the rendered SKILL.md from GET /api/skills/<id>. The agent panel's Skills tab lists what one agent has.
 * Everything here comes through the client cache, so what's been seen once paints at once; an import announces
 * `skills` and the open views refresh.
 */

/** The whole library, most starred first. With no query the route ignores the archetype; the chips filter it here. */
export const skillLibrary: Resource = { key: "/api/skills", topic: "skills" };

/** The archetype chips. They ship with the server's code, so nothing announces them; a restart is caught on reconnect. */
export const archetypeList: Resource = { key: "/api/archetypes", topic: "config" };

function skillSearch(q: string, archetype: Archetype | null): Resource {
  if (!q) return skillLibrary;
  const params = new URLSearchParams({ limit: "50", q });
  if (archetype) params.set("archetype", archetype);
  return { key: `/api/skills?${params}`, topic: "skills" };
}

const skillOf = (id: string): Resource => ({ key: `/api/skills/${id.split("/").map(encodeURIComponent).join("/")}`, topic: "skills" });

type Label = (archetype: string) => string;

/** Chip order and labels from the archetypes (the PM is `lead`, Mira `chief`); a bare id until they've loaded. */
function useArchetypes(): { list: ArchetypeDef[]; label: Label } {
  const list = useCached<ArchetypeDef[]>(archetypeList).data ?? [];
  return { list, label: (id) => list.find((a) => a.id === id)?.name ?? id };
}

const stars = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
/** The SKILL.md body without its frontmatter, which the detail header already shows. */
const body = (md: string) => md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();

const chip = "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] leading-[16px]";
const ringChip = `${chip} bg-white text-ink-2 shadow-[0_0_0_1px_rgba(0,0,0,0.07)]`;

/** Ships scripts (the scan's `executable`), or tagged by the curator as needing a shell or a browser. */
function needs(e: SkillEntry): string[] {
  const out: string[] = [];
  if (e.scan.executable || e.tags.includes("needs-shell")) out.push("Needs shell");
  if (e.tags.includes("needs-browser")) out.push("Needs browser");
  return out;
}

function Meta({ e, label, archetypes = true }: { e: SkillEntry; label: Label; archetypes?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[12.5px] leading-[16px] text-ink-2">{e.source.publisher}</span>
      {e.source.official && (
        <span className={`${chip} bg-accent-wash font-medium text-accent`} title="Published by the product's own organization">
          <BadgeCheck className="size-3" strokeWidth={2.2} />
          Official
        </span>
      )}
      <span className="inline-flex items-center gap-0.5 text-[12px] tabular-nums text-ink-2" title={`${e.source.stars.toLocaleString("en-US")} GitHub stars`}>
        <Star className="size-3" strokeWidth={2} />
        {stars.format(e.source.stars)}
      </span>
      <span className={ringChip} title="License">
        {e.license.replace(/^LicenseRef-/, "")}
      </span>
      {archetypes &&
        e.archetypes.map((a) => (
          <span key={a} className={`${chip} bg-bubble text-ink-2`}>
            {label(a)}
          </span>
        ))}
      {needs(e).map((n) => (
        <span key={n} className={`${chip} bg-caution-wash font-medium text-caution`} title="Stays off until shell tools are sandboxed">
          <SquareTerminal className="size-3" strokeWidth={2} />
          {n}
        </span>
      ))}
    </div>
  );
}

export function SkillRow({ hit, label, onOpen }: { hit: SkillHit; label: Label; onOpen: () => void }) {
  const e = hit.entry;
  return (
    <button type="button" onClick={onOpen} className="tap-soft block w-full border-t border-line px-4 py-3 text-left first:border-t-0 hover:bg-bubble">
      <div className="flex items-baseline gap-2">
        <span className="truncate text-[14.5px] font-medium">{e.name}</span>
        {hit.why && <span className="min-w-0 truncate text-[12px] text-muted">matched {hit.why}</span>}
      </div>
      <p className="mt-0.5 truncate text-[13px] leading-[19px] text-ink-2">{e.description}</p>
      <div className="mt-1.5">
        <Meta e={e} label={label} />
      </div>
    </button>
  );
}

function Notice({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="px-4 py-7 text-center">
      <p className="text-[14.5px] font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-[380px] text-[13px] leading-[19px] text-ink-2">{children}</p>
      {action}
    </div>
  );
}

const retryBtn = "tap mt-3 rounded-full bg-white px-3.5 py-1.5 text-[13.5px] font-medium ring-1 ring-black/10 hover:bg-bubble";

/** The client cache's error is the status code, or the network failure's message. */
function problem(error: string): string {
  return /^\d+$/.test(error) ? `The server answered ${error}` : "The app server didn't answer";
}

/** The library: search, archetype chips, rows; a row opens its detail. */
export function SkillsView() {
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [archetype, setArchetype] = useState<Archetype | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 160);
    return () => clearTimeout(t);
  }, [query]);

  const archetypes = useArchetypes();
  const search = skillSearch(q, archetype);
  const { data: answer, error } = useCached<SkillHit[]>(search);
  // A new search keeps the last list on screen, dimmed, until its own answer lands.
  const [last, setLast] = useState<SkillHit[]>();
  if (answer && answer !== last) setLast(answer);
  const data = answer ?? last;
  const loading = !answer && !!last;
  // The route boosts the archetype's skills; the chip also filters to them.
  const hits = (data ?? []).filter((h) => !archetype || h.entry.archetypes.includes(archetype));

  if (openId) return <SkillDetail id={openId} label={archetypes.label} onBack={() => setOpenId(null)} />;

  return (
    <div className="mx-auto max-w-[620px] px-5 pb-10 pt-6">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
          <Puzzle className="size-[18px] text-ink-2" strokeWidth={1.8} />
        </span>
        <div>
          <h2 className="text-[19px] font-semibold tracking-[-0.01em]">Skills</h2>
          <p className="text-[13px] text-ink-2">Vetted SKILL.md packages experts load when they&apos;re hired.</p>
        </div>
      </div>

      <label className="mt-5 flex h-10 items-center gap-2 rounded-full bg-white px-3.5 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] focus-within:shadow-[0_0_0_2px_#4166eb]">
        <Search className="size-4 shrink-0 text-muted" strokeWidth={2} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Describe the need, e.g. find the root cause of a bug"
          aria-label="Search skills"
          className="own-focus min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted"
        />
        {query && (
          <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="tap grid size-6 place-items-center rounded-full text-muted hover:bg-bubble hover:text-ink">
            <X className="size-3.5" />
          </button>
        )}
      </label>

      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Archetype">
        {[{ id: null, label: "All" } as { id: Archetype | null; label: string }, ...archetypes.list.map((a) => ({ id: a.id, label: a.name }))].map((a) => {
          const on = archetype === a.id;
          return (
            <button
              key={a.label}
              type="button"
              aria-pressed={on}
              onClick={() => setArchetype(a.id)}
              className={`tap relative rounded-full px-3 py-1 text-[13px] ${on ? "font-medium text-white" : "bg-white text-ink-2 shadow-[0_0_0_1px_rgba(0,0,0,0.07)] hover:bg-bubble"}`}
            >
              {on && <motion.span layoutId="skills-archetype" transition={SPRING} className="absolute inset-0 rounded-full bg-accent" />}
              <span className="relative">{a.label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
        {error && !data ? (
          <Notice title="Couldn't load the skills" action={<button type="button" onClick={() => void cache.revalidate(search.key)} className={retryBtn}>Try again</button>}>
            {problem(error)}. Try again in a moment.
          </Notice>
        ) : !data ? (
          <p className="px-4 py-7 text-center text-[13px] text-muted">Loading skills…</p>
        ) : hits.length === 0 ? (
          q || archetype ? (
            <Notice title={q ? `No skill matches "${q}"` : `No ${archetypes.label(archetype!)} skills yet`}>
              When a PM staffs a role the library doesn&apos;t cover, find_skill searches GitHub and brings candidates to you to approve.
            </Notice>
          ) : (
            <Notice title="The library is empty">Skills appear here once they&apos;ve been vetted and imported.</Notice>
          )
        ) : (
          <motion.div animate={{ opacity: loading ? 0.55 : 1 }} transition={{ duration: 0.15 }}>
            <AnimatePresence initial={false}>
              {hits.map((h) => (
                <motion.div key={h.entry.id} layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={SPRING}>
                  <SkillRow hit={h} label={archetypes.label} onOpen={() => setOpenId(h.entry.id)} />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
      {data && hits.length > 0 && (
        <p className="mt-2 px-1 text-[12.5px] text-muted">
          {hits.length} skill{hits.length === 1 ? "" : "s"}
          {q ? ", best match first" : ", most starred first"}
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 px-1 text-[13px] font-medium text-muted">{title}</h3>
      <div className="overflow-hidden rounded-2xl bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">{children}</div>
    </section>
  );
}

function SkillDetail({ id, label, onBack }: { id: string; label: Label; onBack: () => void }) {
  const resource = skillOf(id);
  const { data, error } = useCached<{ entry: SkillEntry; skillMd: string | null }>(resource);
  const e = data?.entry;
  const repoAt = e ? `https://github.com/${e.source.repo}/tree/${e.source.commit}${e.source.path ? `/${e.source.path}` : ""}` : "";
  return (
    <div className="mx-auto max-w-[620px] px-5 pb-10 pt-4">
      <button type="button" onClick={onBack} className="tap -ml-1.5 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[13.5px] text-ink-2 hover:bg-black/[0.05] hover:text-ink">
        <ArrowLeft className="size-4" strokeWidth={1.9} />
        Skills
      </button>
      {!e ? (
        error ? (
          <Notice title="Couldn't load this skill" action={<button type="button" onClick={() => void cache.revalidate(resource.key)} className={retryBtn}>Try again</button>}>
            {problem(error)}.
          </Notice>
        ) : (
          <p className="mt-8 text-center text-[13px] text-muted">Loading the skill…</p>
        )
      ) : (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}>
          <h2 className="mt-3 text-[20px] font-semibold tracking-[-0.01em]">{e.name}</h2>
          <p className="mt-1 text-[14px] leading-[21px] text-ink-2">{e.description}</p>
          <div className="mt-3">
            <Meta e={e} label={label} />
          </div>

          <Section title="Source">
            <a href={repoAt} target="_blank" rel="noreferrer" className="tap-soft flex items-center gap-2 px-4 py-3 text-[14px] hover:bg-bubble">
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                {e.source.repo}
                {e.source.path ? `/${e.source.path}` : ""}
                <span className="text-muted">@{e.source.commit.slice(0, 7)}</span>
              </span>
              <ExternalLink className="size-3.5 shrink-0 text-muted" />
            </a>
            <p className="border-t border-line px-4 py-2.5 text-[12.5px] text-ink-2">
              Added by {e.addedBy === "find_skill" ? "find_skill after your approval" : e.addedBy} on {day(e.addedAt)}
            </p>
          </Section>

          <Section title="Scan">
            <div className="flex items-start gap-2.5 px-4 py-3">
              {e.scan.findings === 0 ? (
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-mint" strokeWidth={2} />
              ) : (
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-danger" strokeWidth={2} />
              )}
              <div className="text-[13.5px] leading-[20px]">
                <p>
                  {e.scan.findings === 0 ? "Clean" : `${e.scan.findings} finding${e.scan.findings === 1 ? "" : "s"}`}
                  <span className="text-ink-2"> · scanned {day(e.scan.at)}</span>
                </p>
                {e.scan.notes && <p className="text-ink-2">{e.scan.notes}</p>}
                {e.scan.executable && <p className="text-caution">Ships scripts, so it stays off until shell tools are sandboxed.</p>}
              </div>
            </div>
          </Section>

          <Section title="Files">
            {e.vendored ? (
              <ul>
                {e.files.map((f) => (
                  <li key={f} className="flex items-center gap-2 border-t border-line px-4 py-2 font-mono text-[12.5px] first:border-t-0">
                    <FileText className="size-3.5 shrink-0 text-muted" strokeWidth={1.8} />
                    {f}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-[13.5px] leading-[20px] text-ink-2">
                Listed with a link only: its files aren&apos;t copied into the library ({e.license.replace(/^LicenseRef-/, "")} license). Agents can&apos;t load it.
              </p>
            )}
          </Section>

          {data.skillMd && (
            <Section title="SKILL.md">
              <div className="px-4 py-3.5 text-[14px] leading-[21px]">
                <Markdown text={body(data.skillMd)} />
              </div>
            </Section>
          )}
        </motion.div>
      )}
    </div>
  );
}

/** An agent's skills: GET /api/skills?agent=<id>, its composition from the hire. */
export const agentSkills = (agentId: string): Resource => ({ key: `/api/skills?agent=${encodeURIComponent(agentId)}`, topic: "skills" });

/** An agent's skills, from the composition it was hired with (Mira has none). */
export function AgentSkillsTab({ agentId, name, onOpenLibrary }: { agentId: string; name: string; onOpenLibrary: () => void }) {
  const { data, error } = useCached<SkillHit[]>(agentSkills(agentId));
  const { label } = useArchetypes();
  const browse = (
    <button type="button" onClick={onOpenLibrary} className={retryBtn}>
      Browse the library
    </button>
  );
  return (
    <section className="mt-6">
      <h3 className="mb-2 px-1 text-[13px] font-medium text-muted">Skills</h3>
      <div className="overflow-hidden rounded-2xl bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
        {!data ? (
          error ? (
            <Notice title="Couldn't load the skills">{problem(error)}.</Notice>
          ) : (
            <p className="px-4 py-7 text-center text-[13px] text-muted">Loading skills…</p>
          )
        ) : data.length === 0 ? (
          <Notice title="No skills yet" action={browse}>
            An agent gets its skills when it&apos;s hired for a role, picked from the library for that role. {name} hasn&apos;t been given any.
          </Notice>
        ) : (
          data.map((h) => <SkillRow key={h.entry.id} hit={h} label={label} onOpen={onOpenLibrary} />)
        )}
      </div>
    </section>
  );
}
