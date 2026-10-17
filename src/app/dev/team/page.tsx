import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DevTeam } from "./DevTeam";

/*
 * Dev only (404 everywhere else): the app with one team already launched, so the state views can be driven in a
 * browser against a seeded DATA_DIR (scripts/dev/seed-state.mts) before Mira can staff projects again.
 *   /dev/team?pid=pricing&lead=juno&members=ana:writer,bo:designer,cy:engineer&name=Pricing%20page%20relaunch
 * No data lives here: the team's state comes from the real GET /api/projects/<pid>/state.
 */
export default function DevTeamPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <Suspense>
      <DevTeam />
    </Suspense>
  );
}
