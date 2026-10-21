// The effect registry: one entry per interaction worth filming, split by feature under shots/ so several people
// (or agents) can add shots at once. Each entry says which core feature it shows (lib.mjs FEATURES) and what it
// demonstrates, so the editing agent can cut by story beat. Agent replies are staged (stage.mjs): no live model.
//   id, feature, title, demonstrates, suggestedUse, staged   notes for the editor (manifest.json)
//   setup({page,d})  full speed, before recording (navigate, scroll, queue staged replies)
//   act({page,d})    slowed + recorded; d.click/d.hover move a visible cursor; d.mark(what, box) names the moments
//                    the editor cuts on, and boxes drive the smart camera (camera.mjs)
//   focus, tail, lead, routes(page), viewer: [...], polish: false   optional
import { EFFECTS as core } from "./shots/core.mjs";
import { EFFECTS as stats } from "./shots/stats.mjs";
import { EFFECTS as soulMemory } from "./shots/soul-memory.mjs";
import { EFFECTS as permissions } from "./shots/permissions.mjs";

export const EFFECTS = [...core, ...stats, ...soulMemory, ...permissions];
