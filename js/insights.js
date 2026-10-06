// Simple descriptive statistics over the last 30 days of events.
// Every insight has a minimum amount of data before it is shown, so the app
// never presents a handful of data points as a pattern.
import { isPee, isPoop, isMeal, isAccident, fmtDuration, slotLabel, sameDay, startOfDay } from './events.js';

const MIN_PEE_GAPS = 10;
const MIN_POOP_GAPS = 6;
const MIN_MEAL_DAYS = 4;
const MIN_MEALS_FOR_PATTERN = 8;
const MIN_PATTERN_PAIRS = 6;
const MIN_PATTERN_SHARE = 0.6;

function percentile(xs, p) {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const median = xs => percentile(xs, 0.5);
const round5 = m => Math.round(m / 5) * 5;

const times = (events, pred) =>
  events.filter(pred).map(e => new Date(e.occurred_at)).sort((a, b) => a - b);

// Minutes between consecutive events on the same day (overnight gaps are excluded).
function sameDayGaps(events, pred, minGap) {
  const ts = times(events, pred);
  const out = [];
  for (let i = 1; i < ts.length; i++) {
    const g = (ts[i] - ts[i - 1]) / 60000;
    if (sameDay(ts[i], ts[i - 1]) && g >= minGap) out.push(g);
  }
  return out;
}

export function peeRhythm(events) {
  const g = sameDayGaps(events, isPee, 5);
  return g.length >= MIN_PEE_GAPS ? { median: median(g), lo: percentile(g, 0.25), hi: percentile(g, 0.75), n: g.length } : null;
}

function poopRhythm(events) {
  const g = sameDayGaps(events, isPoop, 15);
  return g.length >= MIN_POOP_GAPS ? { median: median(g), lo: percentile(g, 0.25), hi: percentile(g, 0.75), n: g.length } : null;
}

// Unlabeled meals are bucketed by time of day so the default one-tap "Meal" still counts.
function mealSlot(e) {
  if (e.event_subtype === 'other') return null;
  if (e.event_subtype) return e.event_subtype;
  const d = new Date(e.occurred_at);
  const h = d.getHours() + d.getMinutes() / 60;
  return h < 10.5 ? 'breakfast' : h < 15 ? 'lunch' : 'dinner';
}

function mealTimes(events) {
  const out = [];
  for (const slot of ['breakfast', 'lunch', 'dinner']) {
    // One value per day: the first meal in that slot.
    const byDay = new Map();
    for (const e of events.filter(e => isMeal(e) && mealSlot(e) === slot)) {
      const d = new Date(e.occurred_at);
      const key = startOfDay(d).getTime();
      const mins = d.getHours() * 60 + d.getMinutes();
      if (!byDay.has(key) || mins < byDay.get(key)) byDay.set(key, mins);
    }
    const mins = [...byDay.values()];
    if (mins.length < MIN_MEAL_DAYS) continue;
    const avg = Math.round(mins.reduce((a, b) => a + b, 0) / mins.length);
    const lo = Math.round(percentile(mins, 0.25)), hi = Math.round(percentile(mins, 0.75));
    out.push({
      slot,
      value: slotLabel(Math.floor(avg / 60), avg % 60),
      detail: `Usually ${slotLabel(Math.floor(lo / 60), lo % 60)}–${slotLabel(Math.floor(hi / 60), hi % 60)} · ${mins.length} days`,
    });
  }
  return out;
}

// How long after eating does the first poop happen (within 2h, before the next meal)?
function poopAfterMeal(events) {
  const meals = times(events, isMeal);
  const poops = times(events, isPoop);
  const delays = [];
  meals.forEach((m, i) => {
    const limit = Math.min(+m + 120 * 60000, meals[i + 1] ? +meals[i + 1] : Infinity);
    const p = poops.find(t => t > m && t <= limit);
    if (p) delays.push((p - m) / 60000);
  });
  if (meals.length < MIN_MEALS_FOR_PATTERN || delays.length < MIN_PATTERN_PAIRS) return null;
  if (delays.length / meals.length < MIN_PATTERN_SHARE) return null;
  const lo = Math.max(0, round5(percentile(delays, 0.25)));
  let hi = round5(percentile(delays, 0.75));
  if (hi <= lo) hi = lo + 5;
  return { lo, hi, n: delays.length, of: meals.length };
}

export function computeInsights(events, puppyName, now = new Date()) {
  const potty = [], feeding = [], patterns = [];

  const pee = peeRhythm(events);
  if (pee) potty.push({
    title: 'Typical time between pees',
    value: `~${fmtDuration(round5(pee.median))}`,
    detail: `Usually ${fmtDuration(round5(pee.lo))}–${fmtDuration(round5(pee.hi))} · ${pee.n} daytime gaps`,
  });

  const poop = poopRhythm(events);
  if (poop) potty.push({
    title: 'Typical time between poops',
    value: `~${fmtDuration(round5(poop.median))}`,
    detail: `Usually ${fmtDuration(round5(poop.lo))}–${fmtDuration(round5(poop.hi))} · ${poop.n} daytime gaps`,
  });

  const weekAgo = startOfDay(now, -6), twoWeeksAgo = startOfDay(now, -13);
  const acc = events.filter(isAccident).map(e => new Date(e.occurred_at));
  const thisWeek = acc.filter(t => t >= weekAgo).length;
  const lastWeek = acc.filter(t => t >= twoWeeksAgo && t < weekAgo).length;
  if (acc.length) potty.push({
    title: 'Accidents, last 7 days',
    value: String(thisWeek),
    detail: `${lastWeek} the week before`,
  });

  for (const m of mealTimes(events)) {
    feeding.push({ title: `Average ${m.slot} time`, value: m.value, detail: m.detail });
  }

  const pam = poopAfterMeal(events);
  if (pam) patterns.push({
    text: `Based on your recent history, ${puppyName} usually poops about ${pam.lo}–${pam.hi} min after eating.`,
    detail: `Seen after ${pam.n} of ${pam.of} meals in the last 30 days.`,
  });

  const counts = {
    pees: events.filter(isPee).length,
    poops: events.filter(isPoop).length,
    meals: events.filter(isMeal).length,
  };
  return { potty, feeding, patterns, counts };
}
