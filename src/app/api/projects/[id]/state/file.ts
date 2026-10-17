import { ProjectId, statePath } from "@/server/project-state";

/** The state files a History sheet may open: the six files and any journal window. */
const STATE_FILE = /^(?:dag\.json|roster\.json|open\.json|decisions\.md|prefs\.md|charter\.md|journal\/[1-9][0-9]*\.md)$/;

/** The vault path behind ?file=<name> for project <id>, or the response to send. */
export function stateFileOr400(id: string, file: string | null): string | Response {
  if (!ProjectId.safeParse(id).success) return Response.json({ error: `"${id}" isn't a project id.` }, { status: 400 });
  if (!file || !STATE_FILE.test(file)) return Response.json({ error: "Send ?file=dag.json (or roster.json, open.json, decisions.md, prefs.md, charter.md, journal/<n>.md)." }, { status: 400 });
  return statePath(id, file);
}
