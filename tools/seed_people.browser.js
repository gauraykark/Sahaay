// Demo seed: Bipul Hazarika's My People cards.
//
// My People is device-local (Dexie only, no server table yet), so it cannot be
// seeded by backend/seed_demo.py the way the patients and their 90 days of
// sessions are. This is the client half of the same demo, and it has to be
// re-runnable because clearing browser data destroys the cards with no
// recovery.
//
// HOW TO RUN
//   1. npm run dev, and sign in as the caregiver
//   2. paste this whole file into the devtools console
//   3. every line must print PASS
//
// Idempotent: it replaces Bipul's cards rather than appending, so running it
// twice leaves three cards, not six.
//
// Photos go in as BLOBS through addVaultPerson -- the same call and the same
// shape the caregiver form uses, since a File off an <input type="file"> is a
// Blob and so is a fetched image. Nothing here is a special seeding path.
//
// Bina deliberately has NO photo, so the large-initial fallback is on screen
// in the demo rather than only in the tests.

(async () => {
  const passed = [];
  const failed = [];
  const ok = (name, cond, detail = "") =>
    cond ? passed.push(name) : failed.push(`${name}${detail ? `: ${detail}` : ""}`);

  const mod = await import("/src/lib/db.js");

  // shared/people.js lives outside the Vite root and is reached through the
  // @shared alias, which only exists at build time -- a console paste cannot
  // resolve it by name. It IS already in the page's module graph though, so
  // find the url the browser actually fetched it from.
  const peopleUrl = performance
    .getEntriesByType("resource")
    .map((r) => r.name)
    .find((n) => /\/shared\/people\.js(\?|$)/.test(n));
  const people = peopleUrl ? await import(peopleUrl).catch(() => null) : null;

  const PATIENT = "Bipul Hazarika";

  // Faces already in the repo (frontend/public/items/faces). These are the
  // social domain's emotion stimuli; reusing two of them keeps the demo to
  // zero new assets.
  const CARDS = [
    {
      face: "man-happy.jpg",
      name: "Rahul",
      relationship: "Your son",
      age: "42",
      occupation: "Teacher",
      home: "Guwahati",
      spouse: "Priya",
      children: "Two — Aarav and Ria",
      likes: "Fishing",
      favouriteFood: "Fish curry",
      visits: "Every Sunday",
      sharedMemory: "You planted the lemon tree together",
    },
    {
      face: "man-calm.jpg",
      name: "Anil",
      relationship: "Your brother",
      age: "68",
      occupation: "Farmer",
      home: "Jorhat",
      spouse: "Meena",
      children: "One — Deepak",
      likes: "Gardening",
      favouriteFood: "Rice and dal",
      visits: "Twice a month",
      sharedMemory: "You both went to the same school",
    },
    {
      face: null, // on purpose -- this card shows a large "B" instead
      name: "Bina",
      relationship: "Your neighbour",
      age: "55",
      occupation: "Shopkeeper",
      home: "Next door",
      likes: "Singing",
      favouriteFood: "Pitha",
      visits: "Every morning",
      sharedMemory: "She brings you tea",
    },
  ];

  // ── Find Bipul ────────────────────────────────────────────────────────────
  //
  // Prefer the server-backed row. A device that has been through a reseed can
  // hold more than one row with this name, and the cards belong on the one the
  // dashboard actually opens.
  const rows = await mod.db.patients.toArray();
  const matches = rows.filter((r) => r.name === PATIENT);
  const patient = matches.find((r) => r.serverId != null) ?? matches[0];

  ok(`${PATIENT} exists on this device`, Boolean(patient),
     `found ${rows.length} patients: ${rows.map((r) => r.name).join(", ")}`);
  if (!patient) {
    console.log(`  FAIL  ${failed[0]}`);
    console.log("\nSEED PEOPLE: FAIL — sign in as the caregiver first, so the patient list hydrates.");
    return;
  }

  // ── Replace, do not append ────────────────────────────────────────────────
  const existing = await mod.db.vaultPeople.where("patientId").equals(patient.id).toArray();
  if (existing.length) {
    await mod.db.vaultPeople.bulkDelete(existing.map((p) => p.id));
  }

  // ── Seed ──────────────────────────────────────────────────────────────────
  for (const { face, ...card } of CARDS) {
    let photo = null;
    if (face) {
      const res = await fetch(`/items/faces/${face}`);
      if (!res.ok) {
        ok(`face ${face} loads`, false, `HTTP ${res.status}`);
        continue;
      }
      photo = await res.blob();
    }
    await mod.addVaultPerson({ ...card, photo, patientId: patient.id });
  }

  // ── Check ─────────────────────────────────────────────────────────────────
  const seeded = await mod.db.vaultPeople.where("patientId").equals(patient.id).toArray();

  ok("three cards on Bipul", seeded.length === 3, `got ${seeded.length}`);
  ok(
    "Rahul and Anil have blob photos",
    ["Rahul", "Anil"].every((n) => seeded.find((p) => p.name === n)?.photo instanceof Blob),
    seeded.map((p) => `${p.name}:${p.photo?.constructor?.name ?? "none"}`).join(" ")
  );
  ok("Bina has no photo, so her card shows an initial",
     seeded.find((p) => p.name === "Bina")?.photo == null);
  ok("every photo decodes",
     await (async () => {
       for (const p of seeded.filter((x) => x.photo)) {
         const url = URL.createObjectURL(p.photo);
         const okDecode = await new Promise((r) => {
           const i = new Image();
           i.onload = () => r(i.naturalWidth > 0);
           i.onerror = () => r(false);
           i.src = url;
         });
         URL.revokeObjectURL(url);
         if (!okDecode) return false;
       }
       return true;
     })());

  if (people) {
    ok("the Test is unlocked at three cards", people.canTest(seeded));
    const round = people.buildPeopleTest(seeded, { seed: 1, count: 6 });
    ok("a round builds", round.length > 0, `got ${round.length}`);
    ok("it asks both memory and social",
       new Set(round.map((q) => q.domain)).size === 2,
       [...new Set(round.map((q) => q.domain))].join(","));
    ok("Bina is never the 'who is this' card, having no face",
       !round.some((q) => q.template === "who" && q.name === "Bina"));
  } else {
    ok("shared/people.js was in the module graph", false,
       "open /patient/vault first, then re-run — the unlock check was skipped");
  }

  for (const n of passed) console.log(`  PASS  ${n}`);
  for (const n of failed) console.log(`  FAIL  ${n}`);
  console.log();
  console.log(
    failed.length
      ? `SEED PEOPLE: FAIL (${failed.length} of ${passed.length + failed.length})`
      : `SEED PEOPLE: OK — reload /patient/vault to see the three cards.`
  );
})();
