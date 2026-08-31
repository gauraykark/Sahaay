// Which local patient rows are real, and which are ghosts.
//
// The device keeps its own copy of the patient list so the app works offline.
// Hydration used to be additive only: it upserted everything the server sent
// and never asked what had gone away. Reseeding the backend hands out fresh
// server ids, so every reseed left the previous generation of rows sitting in
// Dexie forever -- which is how the caregiver ended up looking at twelve
// patients, several of them the same name twice, while the doctor looked at
// three.
//
// Pure on purpose: no Dexie, no fetch. The caller does the deleting, this
// decides. That is what lets tools/test_patient_sync.mjs drive every case in
// node, including the ones that would be destructive against a real database.

/**
 * Split local patient rows into the ones to keep and the ones to drop.
 *
 * @param {object[]} local     Dexie patient rows: {id, name, serverId, isDemo}
 * @param {number[]} remoteIds server ids the server just said it has
 * @returns {{keep: object[], drop: object[], merge: Array<{from:number,to:number}>}}
 *
 * `drop` rows are gone for good. `merge` pairs are duplicates that share a
 * server id: the survivor is named there so the caller can re-point dependent
 * rows instead of deleting sessions somebody actually played.
 *
 * ONLY call this when the remote list actually arrived. An empty `remoteIds`
 * from a real response means "this account has no patients" and correctly
 * clears the ghosts; an empty list because the request failed would wipe the
 * device. The caller must not conflate the two.
 */
export function reconcilePatients(local = [], remoteIds = []) {
  const remote = new Set(remoteIds);
  const keep = [];
  const drop = [];
  const merge = [];
  const survivorFor = new Map();

  // Oldest first, so the row other tables are most likely to already point at
  // is the one that survives a duplicate pair.
  const rows = [...local].sort((a, b) => a.id - b.id);

  for (const row of rows) {
    const serverId = row.serverId ?? null;

    // Never synced. Either the local "Demo" placeholder, or a profile a
    // caregiver created on this device that has not reached the server yet --
    // dropping that would throw away real work that is still queued.
    if (serverId === null) {
      keep.push(row);
      continue;
    }

    // The server no longer has this patient. Nothing on this row can ever
    // sync again, because sync resolves the remote patient by this id.
    if (!remote.has(serverId)) {
      drop.push(row);
      continue;
    }

    const survivor = survivorFor.get(serverId);
    if (survivor !== undefined) {
      merge.push({ from: row.id, to: survivor });
      continue;
    }

    survivorFor.set(serverId, row.id);
    keep.push(row);
  }

  return { keep, drop, merge };
}

/**
 * Which patient the device should treat as active after a reconcile.
 *
 * Returns the current id when it survived, otherwise the single remaining
 * server-backed patient, otherwise null. A dangling active id is worth
 * handling rather than ignoring: getActivePatientId() hands it back happily,
 * getPatient() then returns undefined, and the dashboard renders an empty
 * shell for somebody who no longer exists.
 */
export function resolveActivePatient(activeId, keep = []) {
  if (keep.some((row) => row.id === activeId)) return activeId;

  const real = keep.filter((row) => row.serverId != null);
  if (real.length === 1) return real[0].id;

  return null;
}
