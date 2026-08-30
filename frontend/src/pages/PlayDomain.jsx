// One route for every domain: /patient/play/:domain
//
// Replaces the four hardcoded game routes. A game is no longer a page -- it is
// GameShell plus whichever renderer the selected item asks for, so adding a
// domain costs a bank entry, not a component.
//
// /patient/play with no domain picks one, rotating by day. That is a stand-in:
// SPRINT 5 replaces it with the session runner, which plays all six domains in
// one sitting, twice a day, with a four-hour gap.

import { Navigate, useParams } from "react-router-dom";

import { DOMAINS } from "@shared/domains";
import GameShell from "../components/games/GameShell";

function domainForToday() {
  const day = Math.floor(Date.now() / 86400000);
  return DOMAINS[day % DOMAINS.length];
}

export default function PlayDomain() {
  const { domain } = useParams();
  if (!domain) return <Navigate to={`/patient/play/${domainForToday()}`} replace />;
  if (!DOMAINS.includes(domain)) return <Navigate to="/patient" replace />;
  // Remounting on a domain change resets the shell's frozen round.
  return <GameShell key={domain} domain={domain} />;
}
