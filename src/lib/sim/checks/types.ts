/*
 * The contract between claims (which decide when a deliverable is checked) and the deliverable checks (which read
 * its text). Each check in CHECKS (../scenario.ts) has one CheckFn here, under the same name.
 *
 * Artifact text formats, as the vault stores them: `table` = CSV with a header row, or a Markdown table;
 * `doc` and `sources` = Markdown; `mockup` = one self-contained HTML file; `canvas` = Excalidraw JSON
 * (frames are elements with type "frame" and a numeric width); `chart` = the JSON inside a ```chart fence.
 */
import type { z } from "zod";
import type { CHECKS, CheckName, Deliverable } from "../scenario";

/** One written version of a deliverable. */
export interface DeliverableVersion {
  version: number;
  path: string;
  text: string;
  agentId: string;
  /** ms since the run started. */
  t: number;
  commit?: string;
}

export interface CheckContext {
  /** The deliverable being checked. */
  deliverable: Deliverable;
  /** The version being checked: the accepted one, else the latest; null if it was never written. */
  current(id: string): DeliverableVersion | null;
  versions(id: string): DeliverableVersion[];
  /** Text the team fetched during the run (results of fetch/search tools), for verbatim checks. */
  fetched: string[];
  /** The brief's facts by tag: { F1: "Tern records in-person meetings on the phone.", … }. */
  facts: Record<string, string>;
  /** ```chart fences posted in messages, parsed, in posting order. */
  charts: { agentId: string; spec: unknown; t: number }[];
}

export interface CheckResult {
  pass: boolean;
  /** Short lines a person can verify: what was found, or the first few things that failed. */
  evidence: string[];
}

export type CheckFn<P> = (ctx: CheckContext, params: P) => CheckResult;

/** One implementation per check name; a missing or extra name is a type error. */
export type CheckRegistry = { [K in CheckName]: CheckFn<z.output<(typeof CHECKS)[K]>> };
