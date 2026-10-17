/*
 * Prompt usage notes, one per present tool (docs/research/H-archetype-toolsets.md §6). Constants only: they go in
 * the archetype's "Showing your work" section ahead of SOUL.md, so every agent of an archetype shares those bytes
 * (prefix caching). Never template them with ids, revs, dates or project names; open artifacts and their revs go
 * in the window opener and <state_delta> lines instead.
 */
export { CHARTS_NOTE } from "../charts";

/** The designer's canvas: when to use canvas_edit, one example per op, the closed enums and the chat rule. */
export const CANVAS_NOTE = `Canvas: your designs live on a canvas the owner sees in the work pane. Change it only with canvas_edit (up to 40 ops per call); call canvas_read first if anyone else may have changed it. Put each screen, option or moodboard in its own frame and give every item its frame. Ops (ids are yours: short, lowercase, unique):
- {"op":"frame","id":"f1","name":"Signup A","w":390,"h":844}
- {"op":"shape","id":"b1","frame":"f1","kind":"rect","x":24,"y":700,"w":342,"h":52,"label":"Create account","color":"blue"}
- {"op":"text","id":"t1","frame":"f1","x":24,"y":96,"text":"Welcome","size":"xl"}
- {"op":"note","id":"n1","near":"b1","text":"Primary CTA within thumb reach"}
- {"op":"image","id":"i1","frame":"f3","src":"files/moodboard/ref-3.png","w":200,"h":140}
- {"op":"connect","id":"c1","from":"f1","to":"f2","label":"tap Create"}
- {"op":"update","id":"b1","y":640,"label":"Get started"}
- {"op":"delete","ids":["n1"]}
x and y are pixels inside the frame; leave them out and the item goes in the next free spot. Kinds: rect, ellipse, diamond. Colors: gray, blue, green, yellow, red, violet. Sizes: s, m, l, xl. If an op fails, the others still apply: fix that op and send only it again. If canvas_edit says the canvas changed, call canvas_read and send your ops again. When a frame is ready, call request_review with its id. In chat, say what changed in one or two sentences and name the frame; never paste ops or canvas JSON into a reply.`;

/** The writer's and researcher's docs: create vs suggest vs comment, exact unique anchors, citations, chat rule. */
export const DOC_NOTE = `Docs: long or reusable text goes in a doc, not a reply. To create or rewrite your own doc, use doc_write. If the owner has edited a doc, never rewrite it: propose changes with doc_suggest, where each edit has "find" (an exact passage that appears once, as short as possible), "replace" and a short "why". If a find matches no passage or several, that edit fails: pick a longer passage and send it again. To leave a remark, use doc_comment. Cite sources as [S1], [S2] using the ids add_source returned; if a claim has no source, give it no marker. In chat, say what you changed in one sentence.`;
