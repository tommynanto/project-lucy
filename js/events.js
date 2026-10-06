// Event kinds, labels, and date/time helpers shared by every screen.

// A "kind" is what the user picks; it maps to event_type + event_subtype in the database.
// To add a new kind later: add it here and extend the check constraint in schema.sql.
// `icons` are Google Material Symbols names (loaded in index.html), plus our plain 'drop'.
export const KINDS = {
  pee:           { type: 'potty', subtype: 'pee',           icons: ['drop'],         label: 'Pee',             cat: 'pee' },
  poop:          { type: 'potty', subtype: 'poop',          icons: ['pets'],          label: 'Poop',            cat: 'poop' },
  both:          { type: 'potty', subtype: 'both',          icons: ['drop', 'pets'], label: 'Pee + poop',      cat: 'both' },
  accident_pee:  { type: 'potty', subtype: 'accident_pee',  icons: ['warning'],       label: 'Accident (pee)',  cat: 'accident' },
  accident_poop: { type: 'potty', subtype: 'accident_poop', icons: ['warning'],       label: 'Accident (poop)', cat: 'accident' },
  // Took the puppy out and nothing happened.
  nothing:       { type: 'potty', subtype: 'nothing',       icons: ['do_not_disturb_on'], label: 'Went out, nothing', cat: 'nothing', toast: 'Went out, nothing happened' },
  meal:          { type: 'meal',  subtype: null,            icons: ['restaurant'],    label: 'Meal',            cat: 'meal' },
  // Naps and overnight sleep. occurred_at = start, ended_at = end (null while still in the crate).
  crate:         { type: 'crate', subtype: null,            icons: ['bedtime'],       label: 'Crate time',      cat: 'crate' },
};

// Plain droplet (Google's water_drop has an extra highlight line).
const DROP_SVG = '<svg class="icon icon-svg" viewBox="0 0 24 24" aria-hidden="true">'
  + '<path d="M12 2.6c-.3 0-.6.1-.8.4C9 5.7 5 10.7 5 14.6a7 7 0 0 0 14 0c0-3.9-4-8.9-6.2-11.6-.2-.3-.5-.4-.8-.4z"/></svg>';

export const icon = name =>
  name === 'drop' ? DROP_SVG : `<span class="icon ms" aria-hidden="true">${name}</span>`;

export const kindIcon = kind => KINDS[kind].icons.map(icon).join('');

export const MEAL_LABELS = ['breakfast', 'lunch', 'dinner', 'other'];

export const kindOf = e => (e.event_type === 'potty' ? e.event_subtype : e.event_type);

export const isPee = e => e.event_type === 'potty' && ['pee', 'both', 'accident_pee'].includes(e.event_subtype);
export const isPoop = e => e.event_type === 'potty' && ['poop', 'both', 'accident_poop'].includes(e.event_subtype);
export const isMeal = e => e.event_type === 'meal';
export const isCrate = e => e.event_type === 'crate';
export const isAccident = e => e.event_type === 'potty' && e.event_subtype?.startsWith('accident');

export function eventLabel(e) {
  if (isCrate(e)) {
    return e.ended_at
      ? `Crate time · ${fmtDuration((new Date(e.ended_at) - new Date(e.occurred_at)) / 60000)}`
      : 'Crate time · in progress';
  }
  if (isMeal(e)) {
    const name = e.event_subtype ? cap(e.event_subtype) : 'Meal';
    return e.amount ? `${name} · ${e.amount}` : name;
  }
  return KINDS[e.event_subtype]?.label ?? e.event_subtype;
}

export const eventIcon = e => (KINDS[kindOf(e)] ? kindIcon(kindOf(e)) : '');
export const eventCat = e => KINDS[kindOf(e)]?.cat ?? '';

// ── time ────────────────────────────────────────────────────

export const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

export const fmtTime = d =>
  new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function startOfDay(d, offsetDays = 0) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() + offsetDays);
  return x;
}

export const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();

export function dayLabel(d, now = new Date()) {
  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, startOfDay(now, -1))) return 'Yesterday';
  return new Date(d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function fmtDuration(minutes) {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

// Running timer text, e.g. "34 min" or "1h 12m".
export function elapsed(since, now = new Date()) {
  const min = Math.floor((now - new Date(since)) / 60000);
  return min < 1 ? '<1 min' : fmtDuration(min);
}

export function ago(d, now = new Date()) {
  const min = (now - new Date(d)) / 60000;
  if (min < 1) return 'just now';
  return `${fmtDuration(min)} ago`;
}

const pad = n => String(n).padStart(2, '0');
export const toDateInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toTimeInput = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export function fromInputs(dateStr, timeStr) {
  const [y, mo, da] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  return new Date(y, mo - 1, da, h, mi);
}

// "7:45" style label for a 24h hour/minute, used by the time slots.
export function slotLabel(h, m) {
  return fmtTime(new Date(2000, 0, 1, h, m));
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
