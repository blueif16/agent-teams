/*
 * The fetch every model call goes through (test-mode §4). With CASSETTE unset or `off` it is the global
 * fetch, unchanged. `record:<file>`, `replay:<file>` or `update:<file>` puts the L1 cassette in between;
 * CASSETTE_SPEED (`1`, `4`, … or `inf`, the default) paces replay.
 *
 * One cassette per process for a CASSETTE value, kept on globalThis so dev-server reloads and each route's
 * own copy of this module share its occurrence counts (and a reload doesn't start a recording over).
 * A value that can't be read throws rather than quietly calling the paid API.
 */
import path from "node:path";
import { createCassette, type Cassette, type CassetteMode } from "./cassette";

type Global = { __agentTeamsCassettes?: Map<string, Cassette> };

function speedOf(raw: string | undefined): number {
  const v = raw?.trim().toLowerCase();
  if (!v || v === "inf") return Infinity;
  const n = Number(v);
  if (!(n > 0)) throw new Error(`CASSETTE_SPEED must be a number above 0 or "inf", not "${raw}".`);
  return n;
}

export function modelFetch(): typeof fetch {
  const value = process.env.CASSETTE?.trim();
  if (!value || value === "off") return globalThis.fetch;
  const m = /^(record|replay|update):(.+)$/.exec(value);
  if (!m) throw new Error(`CASSETTE must be off, record:<file>, replay:<file> or update:<file>, not "${value}".`);
  const cassettes = ((globalThis as Global).__agentTeamsCassettes ??= new Map());
  let cassette = cassettes.get(value);
  if (!cassette) {
    cassette = createCassette({ file: path.resolve(m[2]), mode: m[1] as CassetteMode, speed: speedOf(process.env.CASSETTE_SPEED) });
    cassettes.set(value, cassette);
  }
  return cassette.fetch;
}
