/*
 * The simulated owner (docs/design/test-mode.md §3, J §Recommendation). An event loop over the app's tape: it folds
 * each event into the run state, then on every event or timer tick applies the scenario's policy in priority order:
 *   (a) stop: stop.when reached, maxOwnerActions, maxWallMin, the budget (ledger USD or tokens), idleMin;
 *   (b) the launch card: the nth one gets gates.launch.sequence[n], one past the script gets onExtra;
 *   (c) approval cards: the first rule whose regex matches the title and whose maxUsd covers the cost, else the default;
 *   (d) a new deliverable version with a reaction: its rubric decides pass (go) or fail (redo, naming what failed);
 *   (e) scripted beats, each once, when its trigger matches;
 *   (f) questions to the owner, answered only from owner.known, else with unknownReply.
 *
 * Code decides; a model only words answers (phrase) and answers one yes/no rubric question (judge). Every decision
 * is noted on the tape before the action it explains. Time comes only from the injected clock and sleep.
 */
import { CHIEF_ID } from "../data";
import type { CheckRegistry } from "./checks/types";
import type { AppPort } from "./port";
import type { Beat, Scenario, Trigger } from "./scenario";
import { checkContext, foldRun, isActivity, isLaunchCard, placeKey, runCheck, step, type MsgRec, type RunState, type VersionRec } from "./state";
import type { OwnerAction, Place, SimNote, StopReason, TapeEvent, Who } from "./types";

export type Judge = (text: string, question: string) => Promise<{ pass: boolean | null; quote: string }>;
/** fromKnown: 0-based indices into owner.known that the text states; empty when the facts don't answer it. */
export type Phrase = (question: string, known: string[], persona: string) => Promise<{ text: string; fromKnown: number[] }>;

export interface RunOwnerOptions {
  scenario: Scenario;
  port: AppPort;
  /** Milliseconds on the run's monotonic clock. */
  clock: () => number;
  sleep: (ms: number) => Promise<void>;
  checks: CheckRegistry;
  judge: Judge;
  phrase: Phrase;
  /** The brief's facts F1…Fn, for the checks. */
  facts: Record<string, string>;
}

const TICK_MS = 1000;
/** How long a question waits for a beat to answer it before the owner answers. */
export const ANSWER_WAIT_MS = 5000;
/** How long a deliverable waits for its author's message when the author isn't mid-message. */
export const REACT_WAIT_MS = 5000;

const MIRA_DM: Place = { kind: "dm", agentId: CHIEF_ID };
/** The app's id for the owner. */
const OWNER = "you";
const OWNER_MENTION = /@(you|owner)\b/i;
const NEEDS_INPUT = /^[ \t]*needs input:[ \t]*(.+)$/im;
const TICK: unique symbol = Symbol("tick");
const NONE: unique symbol = Symbol("none");

/** The note on a failed deliverable, and on one accepted at the redo cap. The fidelity claim recognizes both. */
export const failNote = (labels: string[]) => `Failed: ${labels.join("; ")}`;
export const capNote = (labels: string[]) => `Accepted at the redo cap; still failing: ${labels.join("; ")}`;

export async function runOwner(o: RunOwnerOptions): Promise<{ stop: StopReason; actions: number }> {
  return new Owner(o).run();
}

class Owner {
  private state: RunState;
  private actions = 0;
  private t0 = 0;
  /** Clock time of the last agent event received. */
  private lastActivity = 0;
  /** Clock time each event was received, by seq. */
  private readonly seenAt = new Map<number, number>();
  private readonly decided = new Set<string>();
  /** Beat id → clock time it fired. */
  private readonly fired = new Map<string, number>();
  /** Where each send beat went, and when, so a question it answered isn't answered twice. */
  private readonly beatSends: { place: string; at: number }[] = [];
  private readonly reacted = new Set<string>();
  private readonly redos = new Map<string, number>();
  private readonly accepted = new Set<string>();
  /** Messages already looked at as questions. */
  private readonly handled = new Set<string>();
  private readonly texts = new Map<string, string>();
  private halt?: StopReason;
  private ended = false;

  constructor(private readonly o: RunOwnerOptions) {
    this.state = foldRun([], o.scenario);
  }

  async run(): Promise<{ stop: StopReason; actions: number }> {
    const { port, clock, sleep, scenario } = this.o;
    const it = port.events()[Symbol.asyncIterator]();
    let next: Promise<IteratorResult<TapeEvent>> | null = it.next();
    this.t0 = this.lastActivity = clock();
    try {
      await this.act({ kind: "send", place: MIRA_DM, text: scenario.request.text });
      const nextTick = () => sleep(TICK_MS).then((): typeof TICK => TICK);
      let tick = nextTick();
      for (;;) {
        const r = await Promise.race(next ? [next, tick] : [tick]);
        if (r === TICK) tick = nextTick();
        else next = this.take(r, it);
        // Fold everything already waiting before deciding, so decisions see the freshest state.
        while (next) {
          const more = await Promise.race([next, Promise.resolve<typeof NONE>(NONE)]);
          if (more === NONE) break;
          next = this.take(more, it);
        }
        const stop = await this.decide();
        if (stop) {
          await it.return?.();
          return { stop, actions: this.actions };
        }
      }
    } catch (e) {
      this.note({ what: "skip", why: `the driver failed: ${(e as Error).message}` });
      await this.stop("error").catch(() => undefined);
      await it.return?.();
      return { stop: "error", actions: this.actions };
    }
  }

  private take(r: IteratorResult<TapeEvent>, it: AsyncIterator<TapeEvent>): Promise<IteratorResult<TapeEvent>> | null {
    if (r.done) {
      this.ended = true;
      return null;
    }
    const e = r.value;
    this.state = step(this.state, e);
    this.seenAt.set(e.seq, this.o.clock());
    if (isActivity(e.kind)) this.lastActivity = this.o.clock();
    return it.next();
  }

  private async decide(): Promise<StopReason | null> {
    for (;;) {
      const stop = this.stopReason();
      if (stop) return this.stop(stop);
      const acted = (await this.launchCard()) || (await this.approvalCard()) || (await this.react()) || (await this.beat()) || (await this.question());
      if (!acted) return null;
    }
  }

  // ---------- (a) stop ----------

  private stopReason(): StopReason | null {
    const { scenario: sc, clock } = this.o;
    if (this.halt) return this.halt;
    if (this.done()) return "done";
    if (this.ended) return "aborted";
    if (this.actions >= sc.stop.maxOwnerActions) return "max_actions";
    const now = clock();
    if (now - this.t0 >= sc.stop.maxWallMin * 60_000) return "max_wall";
    const s = this.state;
    if (s.usd >= sc.budget.maxUsd || s.usage.input + s.usage.output >= sc.budget.maxTokens) return "budget";
    if (now - this.lastActivity >= sc.stop.idleMin * 60_000) return "idle";
    return null;
  }

  private done(): boolean {
    const sc = this.o.scenario;
    if (sc.stop.when === "project_closed") return this.state.closed.length > 0;
    return sc.expect.deliverables.every((d) => this.isAccepted(d.id));
  }

  private async stop(reason: StopReason): Promise<StopReason> {
    this.note({ what: "stop", reason });
    await this.act({ kind: "stop", reason });
    return reason;
  }

  // ---------- (b) the launch card ----------

  private async launchCard(): Promise<boolean> {
    const card = this.pending((c) => isLaunchCard(c));
    if (!card) return false;
    this.decided.add(card.cardId);
    const { sequence, onExtra } = this.o.scenario.gates.launch;
    const st = sequence[card.n];
    if (st) {
      const note = "note" in st ? st.note : undefined;
      this.note({ what: "gate", cardId: card.cardId, decision: st.decision, rule: `launch.sequence[${card.n}]` });
      await this.act({ kind: "decide", cardId: card.cardId, decision: st.decision, ...(note ? { note } : {}) });
    } else if (onExtra === "decline") {
      this.note({ what: "gate", cardId: card.cardId, decision: "decline", rule: "launch.onExtra" });
      await this.act({ kind: "decide", cardId: card.cardId, decision: "decline" });
    } else {
      this.note({ what: "skip", why: `launch card ${card.cardId} is past the ${sequence.length}-step script` });
      this.halt = "error";
    }
    return true;
  }

  // ---------- (c) approval cards ----------

  private async approvalCard(): Promise<boolean> {
    const card = this.pending((c) => c.card === "approval");
    if (!card) return false;
    this.decided.add(card.cardId);
    const { rules, default: fallback } = this.o.scenario.gates.approval;
    const usd = (card.detail as { usd?: unknown } | undefined)?.usd;
    const i = rules.findIndex((r) => new RegExp(r.match).test(card.title) && (r.maxUsd === undefined || (typeof usd === "number" && usd <= r.maxUsd)));
    const rule = rules[i];
    const decision = rule ? rule.decision : fallback;
    this.note({ what: "gate", cardId: card.cardId, decision, rule: rule ? `approval.rules[${i}]` : "approval.default" });
    await this.act({ kind: "decide", cardId: card.cardId, decision, ...(rule?.note ? { note: rule.note } : {}) });
    return true;
  }

  private pending(match: (c: RunState["cards"][number]) => boolean) {
    return this.state.cards.find((c) => match(c) && !c.decided && !this.decided.has(c.cardId));
  }

  // ---------- (d) reactions ----------

  private async react(): Promise<boolean> {
    const sc = this.o.scenario;
    for (const r of sc.reactions) {
      const versions = this.state.versions[r.deliverable] ?? [];
      const v = versions.at(-1);
      if (!v || this.reacted.has(vkey(v))) continue;
      const target = this.reactTarget(v);
      if (target === undefined) continue;
      // A newer version supersedes any older one still waiting.
      for (const old of versions) this.reacted.add(vkey(old));

      const items = sc.rubric.filter((it) => it.deliverable === r.deliverable && (!r.items || r.items.includes(it.id)));
      await this.loadTexts();
      const deliverable = sc.expect.deliverables.find((d) => d.id === r.deliverable)!;
      const ctx = checkContext(this.state, deliverable, (x) => this.textOf(x), this.o.facts, v);
      const failed: string[] = [];
      for (const it of items) {
        if (it.kind === "code") {
          if (!runCheck(this.o.checks, it, ctx).pass && it.gating) failed.push(it.label);
        } else {
          const j = await this.o.judge(this.textOf(v), it.question);
          if (j.pass === false && it.gating) failed.push(it.label);
        }
      }

      const redos = this.redos.get(r.deliverable) ?? 0;
      let order = r.pass;
      let note: string | undefined;
      if (failed.length && redos >= r.maxRedos) note = capNote(failed);
      else if (failed.length) {
        order = r.fail;
        note = failNote(failed);
        this.redos.set(r.deliverable, redos + 1);
      }
      if (order === r.pass) this.accepted.add(r.deliverable);
      this.note({ what: "verdict", deliverable: r.deliverable, pass: failed.length === 0, failed, order });
      if (target === null) this.note({ what: "skip", why: `no message from ${v.agentId} to react to` });
      else await this.act({ kind: "order", msgId: target, order, ...(note ? { note } : {}) });
      return true;
    }
    return false;
  }

  /**
   * The message an order on this version targets: the author's latest finished message at or after the artifact.
   * undefined = wait (the author is mid-message, or REACT_WAIT_MS hasn't passed); null = the author never posted.
   */
  private reactTarget(v: VersionRec): string | null | undefined {
    if (v.msgId) return v.msgId;
    const mine = this.state.messages.filter((m) => m.from === v.agentId);
    const after = mine.filter((m) => m.ended && (m.endSeq ?? 0) >= v.seq);
    if (after.length) return after.reduce((a, b) => ((a.endSeq ?? 0) >= (b.endSeq ?? 0) ? a : b)).msgId;
    if (mine.some((m) => !m.ended)) return undefined;
    if (this.o.clock() - (this.seenAt.get(v.seq) ?? 0) < REACT_WAIT_MS) return undefined;
    return mine.at(-1)?.msgId ?? null;
  }

  private async loadTexts(): Promise<void> {
    for (const list of Object.values(this.state.versions)) {
      for (const v of list) {
        if (v.source !== "artifact" || this.texts.has(vkey(v))) continue;
        this.texts.set(vkey(v), (await this.o.port.read(v.path, v.commit)) ?? "");
      }
    }
  }

  private textOf(v: VersionRec): string {
    return v.source === "chart" ? v.text : (this.texts.get(vkey(v)) ?? "");
  }

  private isAccepted(id: string): boolean {
    return this.accepted.has(id) || id in this.state.accepted;
  }

  // ---------- (e) beats ----------

  private async beat(): Promise<boolean> {
    for (const b of this.o.scenario.beats) {
      if (this.fired.has(b.id) || !this.triggered(b.when)) continue;
      this.fired.set(b.id, this.o.clock());
      await this.fire(b);
      return true;
    }
    return false;
  }

  private triggered(w: Trigger): boolean {
    const s = this.state;
    const now = this.o.clock();
    switch (w.on) {
      case "team.created":
        return s.teams.length > 0;
      case "card":
        return s.cards.some((c) => c.card === w.card);
      case "message": {
        const n = s.messages.filter(
          (m) => m.ended && this.is(m.from, w.from) && (!w.place || m.place.kind === w.place) && (!w.contains || m.text.toLowerCase().includes(w.contains.toLowerCase())),
        ).length;
        return n >= w.nth;
      }
      case "deliverable":
        return (s.versions[w.id]?.length ?? 0) >= w.version;
      case "accepted":
        return this.isAccepted(w.id);
      case "beat": {
        const at = this.fired.get(w.id);
        return at !== undefined && now - at >= w.afterSec * 1000;
      }
      case "idle":
        return now - this.lastActivity >= w.sec * 1000;
    }
  }

  private async fire(b: Beat): Promise<void> {
    const d = b.do;
    if ("send" in d) {
      const to = this.resolveSend(d.send.place, d.send.to);
      if (!to) return this.note({ what: "skip", why: `beat ${b.id}: nobody is "${d.send.to}" yet` });
      this.note({ what: "beat", beat: b.id });
      this.beatSends.push({ place: placeKey(to.place), at: this.o.clock() });
      await this.act({ kind: "send", place: to.place, text: d.send.text, ...(to.mention ? { mention: to.mention } : {}) });
    } else if ("order" in d) {
      const msg = this.latestFrom(d.order.on);
      if (!msg) return this.note({ what: "skip", why: `beat ${b.id}: no message from "${d.order.on}" to order on` });
      this.note({ what: "beat", beat: b.id });
      await this.act({ kind: "order", msgId: msg.msgId, order: d.order.order, ...(d.order.note ? { note: d.order.note } : {}) });
    } else {
      this.note({ what: "beat", beat: b.id });
      const team = this.state.teams[0];
      await this.act({ kind: "advance", to: d.advance, ...(team ? { teamId: team.teamId } : {}) });
    }
  }

  /** mira → her DM; lead or an archetype → that member, @-mentioned in the team channel or in their DM; the lead in the channel needs no mention. */
  private resolveSend(place: "dm" | "channel", to: Who): { place: Place; mention?: string } | null {
    if (to === "mira") return { place: MIRA_DM };
    const team = this.state.teams[0];
    if (to === "any") return team ? { place: place === "channel" ? channel(team.teamId) : dm(team.leadId) } : null;
    const member = this.memberFor(to);
    if (!member) return null;
    if (place === "dm") return { place: dm(member) };
    if (!team) return null;
    return member === team.leadId ? { place: channel(team.teamId) } : { place: channel(team.teamId), mention: member };
  }

  private memberFor(who: Who): string | undefined {
    const team = this.state.teams[0];
    if (who === "mira") return CHIEF_ID;
    if (who === "lead") return team?.leadId;
    const members = team?.members ?? [];
    if (who === "any-expert") return members.find((m) => m.agentId !== team?.leadId)?.agentId;
    if (who === "any") return team?.leadId;
    return members.find((m) => m.archetype === who)?.agentId ?? Object.keys(this.state.archetypeOf).find((id) => this.state.archetypeOf[id] === who);
  }

  /** Does this author count as `who`? */
  private is(agentId: string, who: Who): boolean {
    if (agentId === OWNER) return false;
    const leads = new Set(this.state.teams.map((t) => t.leadId));
    switch (who) {
      case "any":
        return true;
      case "mira":
        return agentId === CHIEF_ID;
      case "lead":
        return leads.has(agentId);
      case "any-expert":
        return agentId !== CHIEF_ID && !leads.has(agentId) && agentId in this.state.archetypeOf;
      default:
        return this.state.archetypeOf[agentId] === who || (who === "chief" && agentId === CHIEF_ID);
    }
  }

  private latestFrom(who: Who): MsgRec | undefined {
    const mine = this.state.messages.filter((m) => this.is(m.from, who));
    return mine.filter((m) => m.ended).at(-1) ?? mine.at(-1);
  }

  // ---------- (f) questions ----------

  private async question(): Promise<boolean> {
    const { scenario: sc, clock } = this.o;
    for (const m of this.state.messages) {
      if (!m.ended || this.handled.has(m.msgId)) continue;
      const q = m.from === OWNER ? null : questionIn(m);
      if (q === null) {
        this.handled.add(m.msgId);
        continue;
      }
      const at = this.seenAt.get(m.endSeq ?? -1) ?? clock();
      const key = placeKey(m.place);
      if (this.beatSends.some((b) => b.place === key && b.at >= at && b.at - at <= ANSWER_WAIT_MS)) {
        this.handled.add(m.msgId);
        continue;
      }
      if (clock() - at < ANSWER_WAIT_MS) continue;
      this.handled.add(m.msgId);

      const known = sc.owner.known;
      const r = await this.o.phrase(q, known, sc.owner.persona);
      const cited = [...new Set((Array.isArray(r?.fromKnown) ? r.fromKnown : []).filter((i) => Number.isInteger(i) && i >= 0 && i < known.length))];
      const said = typeof r?.text === "string" ? r.text.trim() : "";
      // The owner never invents a requirement: no cited fact, no answer of its own.
      const fromKnown = cited.length && said && said !== sc.owner.unknownReply ? cited : [];
      const text = fromKnown.length ? said : sc.owner.unknownReply;
      this.note({ what: "answer", question: q, fromKnown });
      const lead = this.state.teams.some((t) => t.leadId === m.from);
      const mention = m.place.kind === "channel" && !lead ? m.from : undefined;
      await this.act({ kind: "send", place: m.place, text, ...(mention ? { mention } : {}) });
      return true;
    }
    return false;
  }

  // ---------- the port ----------

  private async act(a: OwnerAction): Promise<void> {
    if (a.kind !== "stop") this.actions++;
    await this.o.port.act(a);
  }

  private note(n: SimNote): void {
    this.o.port.note(n);
  }
}

/** A message asks the owner something: a needs-input line anywhere; in Mira's DM, any "?"; in a channel, @you/@owner or a closing "?". */
function questionIn(m: MsgRec): string | null {
  const need = NEEDS_INPUT.exec(m.text);
  if (need) return need[1].trim();
  const text = m.text.trim();
  if (m.place.kind === "dm") return m.place.agentId === CHIEF_ID && m.from === CHIEF_ID && text.includes("?") ? text : null;
  return OWNER_MENTION.test(text) || text.endsWith("?") ? text : null;
}

const vkey = (v: VersionRec) => `${v.deliverable}#${v.version}`;
const dm = (agentId: string): Place => ({ kind: "dm", agentId });
const channel = (teamId: string): Place => ({ kind: "channel", teamId });
