// Sprint 2 DoD, client half: the Dexie v3 -> v4 upgrade loses nothing.
//
// This one needs a real IndexedDB, so it runs in a browser rather than in the
// node gate. Adding fake-indexeddb just to automate it would put a dependency
// in package.json for one test; the browser is the real environment anyway.
//
// HOW TO RUN
//   1. npm run dev
//   2. open the app, then paste this whole file into the devtools console
//   3. every line must print PASS
//
// It DESTROYS the local database it runs against. Use a throwaway profile,
// never a device with real patient data on it.

(async () => {
  const passed = [];
  const failed = [];
  const ok = (name, cond, detail = "") =>
    cond ? passed.push(name) : failed.push(`${name}${detail ? `: ${detail}` : ""}`);
  const eq = (name, got, want) =>
    ok(name, Object.is(got, want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

  const mod = await import("/src/lib/db.js");
  const Dexie = mod.db.constructor;
  mod.db.close();

  for (const d of await indexedDB.databases()) {
    await new Promise((r) => {
      const q = indexedDB.deleteDatabase(d.name);
      q.onsuccess = q.onerror = q.onblocked = r;
    });
  }

  // ── Build a populated v3 database, exactly as the old code would have ─────
  const legacy = new Dexie("sahaay");
  legacy.version(3).stores({
    patients: "++id, name, isDemo, serverId, createdAt",
    gameSessions: "++id, patientId, gameType, score, moves, completed, createdAt, synced",
    difficultyState: "[patientId+gameType], patientId, gameType, level",
    settings: "key",
    vaultPeople: "++id, patientId, name, relationship, createdAt",
    vaultRoutineSteps: "++id, patientId, order, time, activity, createdAt",
    aiPlans: "[patientId+gameType], patientId, gameType, generatedAt",
  });
  await legacy.open();

  const pid = await legacy.patients.add({
    name: "Legacy Patient", isDemo: 0, createdAt: new Date().toISOString(),
  });
  const games = ["memory", "routine", "objects", "name-recall"];
  for (let i = 0; i < 12; i++) {
    await legacy.gameSessions.add({
      patientId: pid, gameType: games[i % 4], score: 7, total: 10, errors: 3,
      level: 2, newLevel: 2, durationMs: 40000, reason: "ok",
      completed: i === 5 ? 0 : 1,
      createdAt: new Date(Date.now() - i * 86400000).toISOString(), synced: 0,
    });
  }
  // A real level 0 — the value the deleted legacy migration would have eaten.
  await legacy.difficultyState.put({
    patientId: pid, gameType: "memory", level: 0,
    reason: "held", source: "rule", updatedAt: new Date().toISOString(),
  });
  await legacy.vaultPeople.add({
    patientId: pid, name: "Rahul", relationship: "Your son", circle: 1,
    createdAt: new Date().toISOString(),
  });
  await legacy.vaultRoutineSteps.add({
    patientId: pid, time: "08:00", activity: "Breakfast", order: 1,
    createdAt: new Date().toISOString(),
  });
  await legacy.settings.put({ key: "memoryDifficultyV2", value: 1 });
  await legacy.settings.put({ key: "activePatientId", value: pid });
  await legacy.aiPlans.put({
    patientId: pid, gameType: "memory", currentLevel: 2,
    ifGood: { level: 3 }, ifOk: { level: 2 }, ifPoor: { level: 1 },
    generatedAt: new Date().toISOString(), roundsSince: 0,
  });
  legacy.close();

  // ── Open with v4 and let the upgrade run ─────────────────────────────────
  const db = (await import("/src/lib/db.js?v4=" + Date.now())).db;
  await db.open();
  const sessions = await db.gameSessions.toArray();

  eq("upgrades to schema v4", db.verno, 4);
  eq("no session is lost", sessions.length, 12);
  eq("the patient survives", await db.patients.count(), 1);
  eq("vault people survive", await db.vaultPeople.count(), 1);
  eq("vault routine survives", await db.vaultRoutineSteps.count(), 1);
  eq("difficulty state survives", await db.difficultyState.count(), 1);
  eq(
    "a stored level 0 survives the upgrade as 0",
    (await db.difficultyState.get([pid, "memory"]))?.level,
    0
  );

  ok("aiPlans is dropped", !db.tables.some((t) => t.name === "aiPlans"));
  ok("domainLevels exists", db.tables.some((t) => t.name === "domainLevels"));
  ok("itemHistory exists", db.tables.some((t) => t.name === "itemHistory"));

  eq("every row gets a status", sessions.filter((r) => r.status === undefined).length, 0);
  eq("the incomplete row becomes abandoned",
     sessions.filter((r) => r.status === "abandoned").length, 1);
  eq("the rest become completed",
     sessions.filter((r) => r.status === "completed").length, 11);

  const keys = (await db.settings.toArray()).map((r) => r.key);
  ok("the inert memoryDifficultyV2 flag is swept", !keys.includes("memoryDifficultyV2"));
  ok("the active patient is kept", keys.includes("activePatientId"));

  // ── Base levels: null and 0 are different facts ──────────────────────────
  const m = await import("/src/lib/db.js?v4=" + Date.now());
  const fresh = await m.getDomainLevels();
  eq("a fresh patient has six keys", Object.keys(fresh).length, 6);
  ok("all six start uncalibrated (null, not 0)",
     Object.values(fresh).every((v) => v === null), JSON.stringify(fresh));

  await m.setDomainLevel("memory", 0);
  await m.setDomainLevel("executive", 7);
  await m.setDomainLevel("social", 99);
  eq("a stored 0 reads back as 0", await m.getDomainLevel("memory"), 0);
  eq("an unwritten domain is still null", await m.getDomainLevel("language"), null);
  eq("99 clamps to the ceiling", await m.getDomainLevel("social"), 15);

  await m.setDomainLevel("memory", 1);
  eq("writing twice upserts", await m.db.domainLevels.count(), 3);
  eq("the new value won", await m.getDomainLevel("memory"), 1);

  let rejected = false;
  try { await m.setDomainLevel("not_a_domain", 3); } catch { rejected = true; }
  ok("an unknown domain is rejected", rejected);

  // ── Item rotation ────────────────────────────────────────────────────────
  await m.recordItemsShown("memory", ["mem-001", "mem-002"]);
  await m.recordItemsShown("memory", ["mem-OLD"],
    new Date(Date.now() - 20 * 86400000).toISOString());
  const recent = await m.recentItemIds("memory");
  ok("items inside the window are excluded from reuse", recent.has("mem-001"));
  ok("items older than 14 days become eligible again", !recent.has("mem-OLD"));

  // ── The abandon path ─────────────────────────────────────────────────────
  const before = await m.db.gameSessions.count();
  await m.logAbandonedSession({
    gameType: "routine", level: 4, durationMs: 9000,
    itemIds: ["exec-01"], sessionId: "sess-1",
  });
  const row = await m.db.gameSessions.orderBy("id").last();
  eq("quitting writes a row", await m.db.gameSessions.count(), before + 1);
  eq("it is marked abandoned", row.status, "abandoned");
  eq("its domain is resolved", row.domain, "executive");
  ok("its scores are NULL, never 0",
     row.score === null && row.total === null && row.errors === null,
     JSON.stringify({ score: row.score, total: row.total, errors: row.errors }));
  ok("an abandoned round still burns the items it showed",
     (await m.recentItemIds("executive")).has("exec-01"));

  // ── Preview mode still writes nothing ────────────────────────────────────
  m.setPreviewMode(true);
  const lvl = await m.getDomainLevel("memory");
  const cnt = await m.db.gameSessions.count();
  await m.setDomainLevel("memory", 12);
  await m.logAbandonedSession({ gameType: "memory", level: 3 });
  await m.recordItemsShown("memory", ["preview-item"]);
  eq("preview does not move a base level", await m.getDomainLevel("memory"), lvl);
  eq("preview does not log a session", await m.db.gameSessions.count(), cnt);
  ok("preview does not burn an item",
     !(await m.recentItemIds("memory")).has("preview-item"));
  m.setPreviewMode(false);

  passed.forEach((n) => console.log("  PASS  " + n));
  failed.forEach((n) => console.log("  FAIL  " + n));
  console.log(
    failed.length
      ? `DEXIE V4: FAIL (${failed.length} of ${passed.length + failed.length})`
      : `DEXIE V4: OK (${passed.length} checks)`
  );
  return { passed: passed.length, failed };
})();
