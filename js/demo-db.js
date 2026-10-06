// Demo mode: the same interface as db.js, but everything lives in memory in the visitor's
// browser. Nothing is sent to Supabase, and every visit starts from the same clean week.
//
// KEEP IN SYNC: when db.js or the database gains a new kind of data (event type, column,
// field), add it here and to generateWeek() so the demo shows it too.
import { startOfDay, toDateInput } from './events.js';

const ALEX = { id: 'demo-alex', name: 'Alex', household_id: 'demo-household' };
const SAM = { id: 'demo-sam', name: 'Sam', household_id: 'demo-household' };

let S = null;

export const configured = true;

export function reset(now = new Date()) {
  S = {
    household: { id: 'demo-household', name: "Biscuit's family", pin: '' },
    puppy: { id: 'demo-puppy', name: 'Biscuit', birth_date: toDateInput(startOfDay(now, -77)) }, // ~11 weeks old
    members: [ALEX, SAM],
    events: generateWeek(now),
  };
}

// A short pause so the app behaves like it does with a real network.
const tick = () => new Promise(r => setTimeout(r, 120));
const copy = x => JSON.parse(JSON.stringify(x));

export async function loadHousehold() {
  await tick();
  return copy({ me: ALEX, household: S.household, puppy: S.puppy, members: S.members });
}

export async function loadMembers() {
  return copy(S.members);
}

export async function loadEvents(puppyId, since) {
  await tick();
  return copy(S.events
    .filter(e => new Date(e.occurred_at) >= since)
    .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at)));
}

export async function addEvent(row) {
  await tick();
  const e = { amount: null, notes: null, ended_at: null, ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() };
  S.events.push(e);
  return copy(e);
}

export async function updateEvent(id, patch) {
  await tick();
  const e = S.events.find(x => x.id === id);
  Object.assign(e, patch);
  return copy(e);
}

export async function deleteEvent(id) {
  await tick();
  S.events = S.events.filter(x => x.id !== id);
}

export const subscribeToEvents = () => () => {};   // only one "phone" in the demo
export async function signOut() {}
export async function createHousehold() { throw new Error('Not available in the demo.'); }
export async function joinHousehold() { throw new Error('Not available in the demo.'); }

// ── Biscuit's week ──────────────────────────────────────────
// A believable routine for an ~11-week-old puppy over the last 7 days, generated relative
// to now (so it always looks current) with a fixed random seed (so every visitor sees the
// same week). Anything scheduled after "now" is left out; crate time in progress has no end.

function seededRandom(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateWeek(now = new Date()) {
  const rand = seededRandom(20261006);
  const between = (a, b) => a + rand() * (b - a);
  const who = () => (rand() < 0.55 ? ALEX : SAM);
  // Day index 0 = six days ago … 6 = today; -1 = the evening before the week starts.
  const at = (day, minutes) => { const d = startOfDay(now, day - 6); d.setMinutes(Math.round(minutes)); return d; };

  const out = [];
  const potty = (day, min, subtype, member = who()) => out.push({ type: 'potty', subtype, start: at(day, min), member });
  const meal = (day, min, subtype, amount) => out.push({ type: 'meal', subtype, amount, start: at(day, min), member: who() });
  const crate = (day, startMin, endMin, member = who()) =>
    out.push({ type: 'crate', subtype: null, start: at(day, startMin), end: at(day, endMin), member });

  const wake = Array.from({ length: 8 }, () => 375 + between(-15, 15));   // ~6:15
  const bed = Array.from({ length: 8 }, () => 1290 + between(-10, 20));   // ~9:30 PM

  // Overnight crate time; the first few nights include a 2 AM pee break.
  for (let day = -1; day <= 6; day++) {
    const b = bed[day + 1], w = 1440 + wake[day + 1];
    if (day <= 1) {
      const night = 1440 + 140 + between(-15, 15);
      crate(day, b, night, ALEX);
      potty(day, night + 5, 'pee', ALEX);
      crate(day, night + 15, w, ALEX);
    } else {
      crate(day, b, w);
    }
  }

  const accidentsByDay = { 0: 2, 1: 1, 2: 1, 3: 1, 5: 1 };   // training improves over the week
  const nothingDays = [1, 3, 4, 6];

  for (let day = 0; day <= 6; day++) {
    const w = wake[day];
    const naps = [
      [540 + between(-20, 20), between(75, 110)],    // morning
      [810 + between(-20, 20), between(90, 120)],    // afternoon
      [1140 + between(-15, 15), between(40, 60)],    // evening
    ].map(([s, len]) => [s, s + len]);
    const fillers = [];

    potty(day, w + 2, 'pee');
    if (rand() < 0.5) potty(day, w + 12, 'poop');

    const b = 420 + between(-15, 15);
    meal(day, b, rand() < 0.5 ? 'breakfast' : null, rand() < 0.4 ? '1 cup' : null);
    potty(day, b + 8, 'pee');
    potty(day, b + between(15, 30), 'poop');

    const l = 720 + between(-15, 15);
    meal(day, l, rand() < 0.3 ? 'lunch' : null, null);
    potty(day, l + 10, 'pee');
    if (rand() < 0.75) potty(day, l + between(20, 35), 'poop');

    const d = 1050 + between(-15, 15);
    meal(day, d, rand() < 0.5 ? 'dinner' : null, rand() < 0.4 ? '1 cup' : null);
    potty(day, d + 10, 'pee');
    potty(day, d + between(15, 30), 'poop');

    for (const [s, e] of naps) {
      potty(day, s - 5, 'pee');
      crate(day, s, e);
      potty(day, e + 3, 'pee');
    }
    potty(day, bed[day + 1] - 8, 'pee');

    // Extra pee breaks during awake stretches, roughly every 50–80 minutes.
    const awake = [[w, naps[0][0]], [naps[0][1], naps[1][0]], [naps[1][1], naps[2][0]], [naps[2][1], bed[day + 1]]];
    for (const [s, e] of awake) {
      for (let t = s + between(50, 80); t < e - 25; t += between(50, 80)) {
        const tooClose = out.some(x => x.subtype === 'pee' && Math.abs(x.start - at(day, t)) < 20 * 60000);
        if (!tooClose) { potty(day, t, 'pee'); fillers.push(out[out.length - 1]); }
      }
    }

    // Turn some extra pee breaks into accidents or "went out, nothing".
    for (let k = 0; k < (accidentsByDay[day] || 0) && fillers.length; k++) {
      fillers.splice(Math.floor(rand() * fillers.length), 1)[0].subtype = day === 3 && k === 0 ? 'accident_poop' : 'accident_pee';
    }
    if (nothingDays.includes(day) && fillers.length) {
      fillers.splice(Math.floor(rand() * fillers.length), 1)[0].subtype = 'nothing';
    }
  }

  return out
    .filter(x => x.start <= now)
    .map(x => ({
      id: crypto.randomUUID(),
      puppy_id: 'demo-puppy',
      household_member_id: x.member.id,
      event_type: x.type,
      event_subtype: x.subtype,
      amount: x.amount ?? null,
      notes: null,
      occurred_at: x.start.toISOString(),
      ended_at: x.type === 'crate' && x.end <= now ? x.end.toISOString() : null,
      created_at: x.start.toISOString(),
    }));
}
