// Ghost patients: the caregiver must see what the doctor sees.
//
// The doctor reads the server directly and keeps no local copy, so their list
// was always right. The caregiver reads Dexie, and hydration was additive
// only -- it upserted whatever the server sent and never asked what had gone
// away. Two backend reseeds later the device held three generations of rows,
// twelve patients with five names appearing twice, all of them pointing at
// server ids that no longer existed.
//
// Run from the repo root:  node tools/test_patient_sync.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { reconcilePatients, resolveActivePatient } from "../shared/patientSync.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "frontend", "src");

const passed = [];
const failed = [];
const ok = (n, c, d = "") => (c ? passed.push(n) : failed.push(d ? `${n}: ${d}` : n));
const eq = (n, got, want) =>
  ok(n, Object.is(got, want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const same = (n, got, want) =>
  ok(
    n,
    JSON.stringify(got) === JSON.stringify(want),
    `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`
  );

const row = (id, name, serverId = null, isDemo = 0) => ({ id, name, serverId, isDemo });
const names = (rows) => rows.map((r) => r.name);
const ids = (rows) => rows.map((r) => r.id);

// ── 1. The reported case, exactly ────────────────────────────────────────────

{
  // What the device actually held: the current three, plus two dead
  // generations of demo patients, five of whose names appear twice.
  const local = [
    row(1, "Demo", null, 1),
    row(2, "Joymoti Gogoi", 101),
    row(3, "Ratan Chakma", 102),
    row(4, "Sushila Tamang", 103),
    row(5, "Alemla Jamir", 104),
    row(6, "Nripen Saikia", 105),
    row(7, "Joymoti Gogoi", 201),
    row(8, "Ratan Chakma", 202),
    row(9, "Sushila Tamang", 203),
    row(10, "Alemla Jamir", 204),
    row(11, "Nripen Saikia", 205),
    row(12, "Kamala Das", 1),
    row(13, "Bipul Hazarika", 2),
    row(14, "Rina Barman", 3),
  ];
  const { keep, drop, merge } = reconcilePatients(local, [1, 2, 3]);

  same(
    "only the server's three patients survive, plus the local placeholder",
    names(keep),
    ["Demo", "Kamala Das", "Bipul Hazarika", "Rina Barman"]
  );
  eq("both dead generations are dropped", drop.length, 10);
  eq("nothing needed merging", merge.length, 0);
  ok(
    "no name appears twice afterwards",
    new Set(names(keep)).size === keep.length,
    names(keep).join(", ")
  );

  // The caregiver's list filters isDemo, which is what the doctor's three are
  // being compared against.
  const caregiverSees = keep.filter((r) => r.isDemo === 0);
  eq("the caregiver list is three, same as the doctor's", caregiverSees.length, 3);
}

// ── 2. Never drop work that has not synced yet ───────────────────────────────

{
  const local = [
    row(1, "Demo", null, 1),
    row(2, "Added on this phone", null, 0), // created locally, never synced
    row(3, "Kamala Das", 1),
    row(4, "Old ghost", 99),
  ];
  const { keep, drop } = reconcilePatients(local, [1]);

  ok(
    "a locally created patient with no serverId is kept",
    names(keep).includes("Added on this phone"),
    "dropping it would throw away a profile still queued to sync"
  );
  ok("the local Demo placeholder is kept", names(keep).includes("Demo"));
  same("only the stale row goes", names(drop), ["Old ghost"]);
}

// ── 3. Duplicates that share a server id are merged, not deleted ─────────────

{
  const local = [row(5, "Kamala Das", 1), row(9, "Kamala Das", 1)];
  const { keep, drop, merge } = reconcilePatients(local, [1]);

  same("the older row survives a duplicate pair", ids(keep), [5]);
  eq("the duplicate is not simply deleted", drop.length, 0);
  same("its rows are re-pointed at the survivor", merge, [{ from: 9, to: 5 }]);
}

{
  // Order of the input must not decide the outcome.
  const a = reconcilePatients([row(9, "K", 1), row(5, "K", 1)], [1]);
  same("the oldest wins regardless of input order", ids(a.keep), [5]);
  same("and the newer one merges into it", a.merge, [{ from: 9, to: 5 }]);
}

// ── 4. An empty server list is an answer, not an error ───────────────────────

{
  const local = [row(1, "Demo", null, 1), row(2, "Ghost", 7), row(3, "Unsynced", null, 0)];
  const { keep, drop } = reconcilePatients(local, []);

  same("a caregiver with no patients keeps only unsynced rows", names(keep), [
    "Demo",
    "Unsynced",
  ]);
  same("and the server-backed ghost goes", names(drop), ["Ghost"]);
}

// ── 5. The active patient never dangles ──────────────────────────────────────

{
  const keep = [row(1, "Demo", null, 1), row(13, "Bipul Hazarika", 2)];

  eq("an active patient that survived stays active", resolveActivePatient(13, keep), 13);
  eq(
    "an active patient that was dropped falls to the single real one",
    resolveActivePatient(7, keep),
    13
  );
  eq(
    "with several real patients it picks none, so the list is shown",
    resolveActivePatient(7, [row(1, "A", 1), row(2, "B", 2)]),
    null
  );
  eq(
    "with no real patients at all it clears",
    resolveActivePatient(7, [row(1, "Demo", null, 1)]),
    null
  );
  eq("a device that never had one stays that way", resolveActivePatient(undefined, keep), 13);
}

// ── 6. Idempotence ───────────────────────────────────────────────────────────

{
  const local = [row(1, "Demo", null, 1), row(2, "Ghost", 9), row(3, "Kamala Das", 1)];
  const first = reconcilePatients(local, [1]);
  const second = reconcilePatients(first.keep, [1]);

  eq("a second pass drops nothing", second.drop.length, 0);
  eq("and merges nothing", second.merge.length, 0);
  same("the list is stable", names(second.keep), names(first.keep));
}

// ── 7. Offline must never be read as "you have no patients" ──────────────────

{
  const api = readFileSync(join(SRC, "lib", "api.js"), "utf8");
  const start = api.indexOf("export async function hydratePatientsFromServer");
  const body = api.slice(start, api.indexOf("\nexport ", start + 10));

  ok("hydration exists", start !== -1);
  ok(
    "the prune is wired into hydration",
    /pruneGhostPatients\(/.test(body),
    "ghosts would never be cleared"
  );

  // The failure path must return BEFORE the prune. If a thrown request were
  // treated as an empty patient list, going offline would wipe the device's
  // only copy of the patient list.
  const catchAt = body.indexOf("catch");
  const pruneAt = body.indexOf("pruneGhostPatients(");
  const returnAfterCatch = body.indexOf("return []", catchAt);
  ok(
    "a failed fetch returns before anything is pruned",
    catchAt !== -1 && returnAfterCatch !== -1 && returnAfterCatch < pruneAt,
    "offline would delete the local patient list"
  );
  ok(
    "the prune is driven by the ids the server actually returned",
    /pruneGhostPatients\(\s*remote\.map\(/.test(body),
    "it must not be handed a list assembled locally"
  );

  const dbSrc = readFileSync(join(SRC, "lib", "db.js"), "utf8");
  ok(
    "dropping a patient takes their dependent rows with them",
    /PATIENT_OWNED_TABLES/.test(dbSrc),
    "orphan sessions would accumulate against ids that no longer exist"
  );
  ok(
    "merged duplicates re-point their rows instead of losing them",
    /modify\(\{\s*patientId:\s*to\s*\}\)/.test(dbSrc)
  );
  ok(
    "a dangling active patient is repaired",
    /resolveActivePatient\(/.test(dbSrc),
    "the dashboard would render an empty shell for somebody who is gone"
  );
}

for (const n of passed) console.log(`  PASS  ${n}`);
for (const n of failed) console.log(`  FAIL  ${n}`);
console.log();
if (failed.length) {
  console.log(`PATIENT SYNC: FAIL (${failed.length} of ${passed.length + failed.length})`);
  process.exit(1);
}
console.log(`PATIENT SYNC: OK (${passed.length} checks)`);
