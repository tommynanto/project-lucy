import * as realDb from './db.js';
import * as demoDb from './demo-db.js';
import {
  KINDS, icon, kindIcon, eventLabel, eventIcon, eventCat, isPee, isPoop, isMeal, isCrate, isAccident,
  fmtTime, ago, elapsed, startOfDay, sameDay, dayLabel, fmtDuration, esc,
} from './events.js';
import { computeInsights, peeRhythm } from './insights.js';
import { openSheet } from './sheet.js';
import { retrieverSketch } from './logo.js';

// Demo mode (…/project-lucy/?demo): same app, but data comes from demo-db.js in memory.
// Nothing touches Supabase, and every visit starts from the same clean week.
const DEMO = new URLSearchParams(location.search).has('demo');
const db = DEMO ? demoDb : realDb;

const app = document.getElementById('app');
const DAYS_LOADED = 30;
// Shown at the bottom of every screen. Bump this when you publish an update.
const VERSION = '1.4';
const versionTag = `<p class="version">Version ${VERSION}</p>`;

const state = {
  household: null, puppy: null, me: null, members: [],
  events: [],              // newest first
  accidentOpen: false,
  historyRange: 'today',
  welcome: 'choose',       // choose | start | join
  form: {}, formError: '', busy: false,
};

const currentView = () => location.hash.replace('#', '') || 'today';

// ── data ────────────────────────────────────────────────────

const byNewest = (a, b) => new Date(b.occurred_at) - new Date(a.occurred_at);

async function loadEvents() {
  const fresh = await db.loadEvents(state.puppy.id, startOfDay(new Date(), -DAYS_LOADED));
  const pending = state.events.filter(e => e.pending);
  state.events = [...pending, ...fresh].sort(byNewest);
}

function putLocal(event, replaceId = event.id) {
  state.events = state.events.filter(e => e.id !== replaceId && e.id !== event.id);
  state.events.push(event);
  state.events.sort(byNewest);
}

const removeLocal = id => { state.events = state.events.filter(e => e.id !== id); };

// The same person can appear more than once (rejoined, or a second phone). Show each name once,
// ignoring capitals and extra spaces, keeping the first spelling.
function uniqueNames(members) {
  const seen = new Set();
  return members.map(m => m.name.trim()).filter(n => {
    const key = n.toLowerCase();
    return !seen.has(key) && seen.add(key);
  });
}

const memberName = id => state.members.find(m => m.id === id)?.name ?? '';

async function enterHousehold() {
  const h = await db.loadHousehold();
  if (!h) throw new Error("Couldn't load your household. Please try again.");
  await useHousehold(h);
}

let stopLive = null;

async function useHousehold(h) {
  Object.assign(state, h);
  await loadEvents();
  // Instant updates: when anyone in the household adds, edits or deletes an event,
  // reload right away. (Several changes in a row are batched into one reload.)
  stopLive?.();
  let timer;
  stopLive = db.subscribeToEvents(state.puppy.id, () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 300);
  });
}

async function refresh() {
  if (!state.household || document.hidden) return;
  try {
    [state.members] = await Promise.all([db.loadMembers(state.household.id), loadEvents()]);
    render();
  } catch { /* offline or transient; try again next tick */ }
}

// ── logging ─────────────────────────────────────────────────

const SAVE_FAILED = "Couldn't save — check your connection and try again.";
const UNDO_FAILED = "Couldn't undo. Tap the event to fix it.";

const activeCrate = () => state.events.find(e => e.event_type === 'crate' && !e.ended_at);

const newRow = (kind, at) => ({
  puppy_id: state.puppy.id,
  household_member_id: state.me.id,
  event_type: KINDS[kind].type,
  event_subtype: KINDS[kind].subtype,
  occurred_at: at.toISOString(),
});

// Shows the event immediately and saves it in the background.
// `temp.ready` resolves to the saved row (or null if it failed / was undone).
function optimisticAdd(row) {
  const temp = { ...row, id: `tmp-${Date.now()}-${Math.random()}`, pending: true };
  let saved = null, undone = false;
  temp.ready = db.addEvent(row).then(r => {
    saved = r;
    if (undone) { db.deleteEvent(r.id).catch(() => {}); return null; }
    putLocal(r, temp.id);
    render();
    return r;
  }).catch(() => {
    removeLocal(temp.id);
    render();
    if (!undone) toast(SAVE_FAILED, { error: true });
    return null;
  });
  putLocal(temp);
  return {
    undo() {
      undone = true;
      removeLocal(saved?.id ?? temp.id);
      render();
      if (saved) db.deleteEvent(saved.id).catch(() => toast(UNDO_FAILED, { error: true }));
    },
  };
}

// Sets ended_at on a crate-time event (waiting for it to be saved first if needed).
function endCrate(crate, at) {
  const endedAt = at.toISOString();
  const setLocal = (id, v) => { const e = state.events.find(x => x.id === id); if (e) e.ended_at = v; };
  let id = crate.id, undone = false, updated = false;
  setLocal(id, endedAt);

  const done = (crate.pending ? crate.ready : Promise.resolve(crate))
    .then(real => {
      if (!real || undone) return;
      id = real.id;
      setLocal(id, endedAt);
      render();
      return db.updateEvent(id, { ended_at: endedAt }).then(r => {
        updated = true;
        if (!undone) { putLocal(r); render(); }
      });
    })
    .catch(() => { setLocal(id, null); render(); toast(SAVE_FAILED, { error: true }); });

  return {
    minutes: Math.max(1, (at - new Date(crate.occurred_at)) / 60000),
    undo() {
      undone = true;
      setLocal(id, null);
      render();
      done.then(() => updated && db.updateEvent(id, { ended_at: null }))
        .then(r => { if (r) { putLocal(r); render(); } })
        .catch(() => toast(UNDO_FAILED, { error: true }));
    },
  };
}

// One tap → logged at the current time. Logging anything ends crate time.
function quickLog(kind) {
  state.accidentOpen = false;
  navigator.vibrate?.(15);
  const now = new Date();

  if (kind === 'crate') {
    const added = optimisticAdd({ ...newRow('crate', now), ended_at: null });
    render();
    return toast(`Crate time started — ${fmtTime(now)}`, { undo: added.undo });
  }

  const crate = activeCrate();
  const ended = crate ? endCrate(crate, now) : null;
  const added = optimisticAdd(newRow(kind, now));
  render();
  toast(`${KINDS[kind].toast ?? `${KINDS[kind].label} logged`} — ${fmtTime(now)}${ended ? ` · crate time ended (${fmtDuration(ended.minutes)})` : ''}`, {
    undo: () => { added.undo(); ended?.undo(); },
  });
}

function endCrateNow() {
  const crate = activeCrate();
  if (!crate) return;
  navigator.vibrate?.(15);
  const ended = endCrate(crate, new Date());
  render();
  toast(`Crate time ended — ${fmtDuration(ended.minutes)}`, { undo: ended.undo });
}

function openAdd() {
  openSheet({
    onSave: async fields => {
      const saved = await db.addEvent({ ...fields, puppy_id: state.puppy.id, household_member_id: state.me.id });
      putLocal(saved);
      render();
      toast(`${eventLabel(saved)} added — ${dayLabel(saved.occurred_at)} ${fmtTime(saved.occurred_at)}`);
    },
  });
}

function openEdit(id) {
  const event = state.events.find(e => e.id === id);
  if (!event) return;
  if (event.pending) return toast('Still saving — try again in a second.');
  openSheet({
    event,
    onSave: async fields => {
      putLocal(await db.updateEvent(id, fields));
      render();
      toast('Event updated');
    },
    onDelete: async () => {
      await db.deleteEvent(id);
      removeLocal(id);
      render();
      toast('Event deleted');
    },
  });
}

// ── toast ───────────────────────────────────────────────────

const toastEl = document.getElementById('toast');
let toastTimer;

function toast(msg, { undo, error } = {}) {
  toastEl.className = `show${error ? ' error' : ''}`;
  toastEl.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button" data-undo>Undo</button>' : ''}`;
  toastEl.onclick = e => { if (undo && e.target.closest('[data-undo]')) { hideToast(); undo(); } };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, undo ? 6000 : 3500);
}
const hideToast = () => { toastEl.className = ''; };

// ── views ───────────────────────────────────────────────────

function eventList(events) {
  if (!events.length) return '<p class="empty">Nothing logged yet.</p>';
  const showWho = uniqueNames(state.members).length > 1;
  return `<ul class="timeline">${events.map(e => `
    <li><button type="button" class="ev cat-${eventCat(e)}${e.pending ? ' pending' : ''}" data-edit="${e.id}">
      <span class="ev-time">${fmtTime(e.occurred_at)}</span>
      <span class="ev-icon">${eventIcon(e)}</span>
      <span class="ev-label">${esc(eventLabel(e))}</span>
      ${showWho ? `<span class="ev-who">${esc(memberName(e.household_member_id))}</span>` : ''}
    </button></li>`).join('')}</ul>`;
}

const plural = (n, word) => `${n} ${n === 1 ? word : word + 's'}`;

// "6 pees · 3 poops · 3 meals · 1 accident" (accidents aren't counted as pees/poops)
function countParts(events) {
  const ok = e => !isAccident(e);
  const parts = [
    [events.filter(e => isPee(e) && ok(e)).length, 'pee'],
    [events.filter(e => isPoop(e) && ok(e)).length, 'poop'],
    [events.filter(isMeal).length, 'meal'],
  ];
  const acc = events.filter(isAccident).length;
  if (acc) parts.push([acc, 'accident']);
  return parts;
}

const dayCounts = events => countParts(events).map(([n, w]) => plural(n, w)).join(' · ');

function puppyAge() {
  if (!state.puppy.birth_date) return '';
  const weeks = Math.floor((Date.now() - new Date(state.puppy.birth_date + 'T00:00')) / (7 * 864e5));
  if (weeks < 0) return '';
  return weeks < 26 ? `${weeks} weeks old` : `${Math.floor(weeks / 4.345)} months old`;
}

function todayView() {
  const now = new Date();
  const ev = state.events;
  const today = ev.filter(e => sameDay(e.occurred_at, now));
  const last = pred => ev.find(pred);
  const stat = (label, e) => `
    <div class="stat"><div class="stat-label">${label}</div>
    <div class="stat-value">${e ? ago(e.occurred_at, now) : '—'}</div></div>`;

  let hint = '';
  const rhythm = peeRhythm(ev), lastPee = last(isPee);
  if (rhythm && lastPee && sameDay(lastPee.occurred_at, now)) {
    const since = (now - new Date(lastPee.occurred_at)) / 60000;
    if (since >= rhythm.median) {
      hint = `<p class="hint">${icon('drop')} Based on recent history, a pee break may be due — usually every ~${fmtDuration(Math.round(rhythm.median / 5) * 5)}.</p>`;
    }
  }

  const crate = activeCrate();
  // Awake timer: since the most recent crate time ended (only if that was within 12 hours).
  const lastWake = crate ? null : ev.filter(e => isCrate(e) && e.ended_at)
    .map(e => e.ended_at).sort().pop();
  const awake = lastWake && now - new Date(lastWake) < 12 * 3600e3 ? lastWake : null;
  return `
    <header class="top">
      <div><h1>${esc(state.puppy.name)}</h1>${puppyAge() ? `<div class="sub">${puppyAge()}</div>` : ''}</div>
      <div class="top-actions">
        <button type="button" class="icon-btn small" data-action="theme" aria-label="${isDark() ? 'Switch to day mode' : 'Switch to night mode'}">${icon(isDark() ? 'light_mode' : 'dark_mode')}</button>
        <a href="#settings" class="icon-btn" aria-label="Household settings">${icon('settings')}</a>
      </div>
    </header>

    ${crate ? `
      <div class="crate-banner">
        <span class="crate-icon">${icon('bedtime')}</span>
        <div class="crate-text">
          <div class="crate-label">In crate since ${fmtTime(crate.occurred_at)}</div>
          <div class="crate-elapsed" data-since="${crate.occurred_at}">${elapsed(crate.occurred_at)}</div>
        </div>
        <button type="button" class="btn crate-end" data-action="end-crate">End</button>
      </div>` : ''}
    ${awake ? `
      <div class="awake-line">
        <span class="awake-icon">${icon('light_mode')}</span>
        <span>Awake for <b data-since="${awake}">${elapsed(awake)}</b></span>
        <span class="awake-since">since ${fmtTime(awake)}</span>
      </div>` : ''}

    <section class="summary">
      <div class="stats">
        ${stat('Last pee', last(isPee))}
        ${stat('Last poop', last(isPoop))}
        ${stat('Last meal', last(isMeal))}
      </div>
      ${hint}
    </section>

    <section class="actions">
      <div class="btn-grid">
        <button type="button" class="log-btn cat-pee" data-log="pee"><span class="btn-icon">${kindIcon('pee')}</span>Pee</button>
        <button type="button" class="log-btn cat-poop" data-log="poop"><span class="btn-icon">${kindIcon('poop')}</span>Poop</button>
      </div>
      ${state.accidentOpen ? `
        <div class="secondary-row accident-row">
          <span>Accident:</span>
          <button type="button" class="btn accident" data-log="accident_pee">${kindIcon('pee')} Pee</button>
          <button type="button" class="btn accident" data-log="accident_poop">${kindIcon('poop')} Poop</button>
          <button type="button" class="icon-btn" data-action="accident" aria-label="Cancel">${icon('close')}</button>
        </div>` : `
        <div class="secondary-row">
          <button type="button" class="btn ghost small nothing-btn" data-log="nothing">${kindIcon('nothing')} Went out, nothing</button>
          <button type="button" class="btn ghost small accident-btn" data-action="accident">${icon('warning')} Accident</button>
        </div>`}

      <button type="button" class="log-btn wide group-gap cat-meal" data-log="meal"><span class="btn-icon">${kindIcon('meal')}</span>Meal</button>

      ${crate
        ? `<button type="button" class="log-btn wide group-gap cat-crate on" data-action="end-crate"><span class="btn-icon">${kindIcon('crate')}</span>End crate time</button>`
        : `<button type="button" class="log-btn wide group-gap cat-crate" data-log="crate"><span class="btn-icon">${kindIcon('crate')}</span>Crate time</button>`}

      <div class="secondary-row add-row">
        <button type="button" class="btn ghost" data-action="add">${icon('add')} Add earlier event</button>
      </div>
    </section>

    <section>
      <h2 class="section-title">Today</h2>
      <div class="today-counts">${countParts(today).map(([n, w]) => `<b>${n}</b> ${plural(n, w).replace(/^\d+ /, '')}`).join(' · ')}</div>
      ${eventList(today)}
    </section>`;
}

const RANGES = { today: ['Today', 0, 0], yesterday: ['Yesterday', -1, -1], week: ['Last 7 days', -6, 0] };

function historyView() {
  const [, from, to] = RANGES[state.historyRange];
  const now = new Date();
  const days = [];
  for (let i = to; i >= from; i--) {
    const day = startOfDay(now, i);
    const events = state.events.filter(e => sameDay(e.occurred_at, day));
    days.push(`
      <section class="day">
        <div class="day-head"><h2>${dayLabel(day, now)}</h2><span>${dayCounts(events)}</span></div>
        ${eventList(events)}
      </section>`);
  }
  return `
    <header class="top"><h1>History</h1>
      <button type="button" class="icon-btn" data-action="add" aria-label="Add earlier event">${icon('add')}</button></header>
    <div class="segmented" role="tablist">
      ${Object.entries(RANGES).map(([k, [label]]) =>
        `<button type="button" role="tab" aria-selected="${state.historyRange === k}" class="${state.historyRange === k ? 'on' : ''}" data-range="${k}">${label}</button>`).join('')}
    </div>
    ${days.join('')}`;
}

function insightsView() {
  const { potty, feeding, patterns, counts } = computeInsights(state.events, state.puppy.name);
  const card = i => `<div class="insight"><div class="stat-label">${i.title}</div><div class="insight-value">${i.value}</div><div class="insight-detail">${i.detail}</div></div>`;
  const group = (title, items) => items.length ? `<h2 class="section-title">${title}</h2><div class="insight-grid">${items.map(card).join('')}</div>` : '';
  const empty = !potty.length && !feeding.length && !patterns.length;
  return `
    <header class="top"><h1>Insights</h1></header>
    <p class="muted">Based on the last ${DAYS_LOADED} days. Insights only appear once there's enough data to be meaningful.</p>
    ${group('Potty', potty)}
    ${group('Feeding', feeding)}
    ${patterns.length ? `<h2 class="section-title">Patterns</h2>${patterns.map(p => `<div class="pattern"><p>${esc(p.text)}</p><div class="insight-detail">${p.detail}</div></div>`).join('')}` : ''}
    ${empty ? `<div class="empty-card"><p><b>Not enough data yet.</b> Keep logging — after a few days you'll see typical gaps between potty breaks and usual meal times.</p>
      <p class="muted">So far: ${counts.pees} pees · ${counts.poops} poops · ${counts.meals} meals.</p></div>` : ''}`;
}

function settingsView() {
  const { household, puppy, me, members } = state;
  return `
    <header class="top"><a href="#today" class="icon-btn" aria-label="Back">${icon('chevron_left')}</a><h1>Household</h1><span></span></header>
    <div class="card">
      <div class="kv"><span>Household</span><b>${esc(household.name)}</b></div>
      ${DEMO ? '' : `<div class="kv"><span>PIN</span><b class="pin">${esc(household.pin)}</b></div>`}
      <div class="kv"><span>Puppy</span><b>${esc(puppy.name)}${puppyAge() ? ` · ${puppyAge()}` : ''}</b></div>
      <div class="kv"><span>You</span><b>${esc(me.name)}</b></div>
      <div class="kv"><span>Members</span><b>${uniqueNames(members).map(esc).join(', ')}</b></div>
    </div>
    ${DEMO ? `
    <h2 class="section-title">About this demo</h2>
    <p class="muted">Biscuit, Alex and Sam are made up. In a real household, each family member joins on their own phone with the household name and a 4-digit PIN, and everyone sees the same timeline, updated instantly.</p>
    <a class="btn ghost" href="./">Exit demo</a>` : `
    <h2 class="section-title">Add someone</h2>
    <p class="muted">They open this website on their phone, tap <b>Join a household</b>, and enter <b>${esc(household.name)}</b> and the PIN above.</p>
    <h2 class="section-title">This phone</h2>
    <p class="muted">Tip: use your browser's “Add to Home Screen” for one-tap access.</p>
    <button type="button" class="btn ghost" data-action="signout">Sign out on this phone</button>`}`;
}

function welcomeView() {
  const f = state.form;
  const field = (name, label, attrs = '') =>
    `<label class="field"><span>${label}</span><input name="${name}" value="${esc(f[name] ?? '')}" ${attrs}></label>`;
  const pin = field('pin', '4-digit PIN', 'inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" required');
  const error = state.formError ? `<p class="form-error">${esc(state.formError)}</p>` : '';
  const submit = label => `<button class="btn primary big" ${state.busy ? 'disabled' : ''}>${state.busy ? 'One moment…' : label}</button>`;
  const back = '<button type="button" class="btn link" data-welcome="choose">Back</button>';

  if (state.welcome === 'start') return `
    <form class="welcome" data-form="start">
      <h1>New household</h1>
      ${field('householdName', 'Household name', 'placeholder="e.g. The Smiths" autocomplete="off" required maxlength="60"')}
      ${pin}
      <p class="field-hint">Other family members join with the household name + PIN.</p>
      ${field('puppyName', "Puppy's name", 'autocomplete="off" required maxlength="40"')}
      ${field('birthDate', 'Birth date (optional)', 'type="date"')}
      ${field('memberName', 'Your name', 'autocomplete="given-name" required maxlength="40"')}
      ${error}${submit('Start')}${back}
    </form>`;

  if (state.welcome === 'join') return `
    <form class="welcome" data-form="join">
      <h1>Join a household</h1>
      ${field('householdName', 'Household name', 'autocomplete="off" required')}
      ${pin}
      ${field('memberName', 'Your name', 'autocomplete="given-name" required maxlength="40"')}
      ${error}${submit('Join')}${back}
    </form>`;

  return `
    <div class="welcome">
      <div class="brand">${retrieverSketch()}</div>
      <h1>Project Lucy</h1>
      <p class="muted">Puppy Tracker · a shared log of your puppy's potty breaks, meals and crate time.</p>
      <button type="button" class="btn primary big" data-welcome="start">Start a new household</button>
      <button type="button" class="btn secondary big" data-welcome="join">Join a household</button>
      <a class="demo-link" href="?demo">Try the demo ${icon('arrow_forward')}</a>
    </div>`;
}

const demoBanner = `
  <div class="demo-banner">
    <span><b>Demo</b> · Biscuit's made-up week. Changes aren't saved.</span>
    <a href="./">Exit demo</a>
  </div>`;

const VIEWS = { today: todayView, history: historyView, insights: insightsView, settings: settingsView };

function render() {
  if (!state.household) {
    app.innerHTML = `<main class="content narrow">${welcomeView()}${versionTag}</main>`;
    return;
  }
  const v = VIEWS[currentView()] ? currentView() : 'today';
  const tab = (id, iconName, label) =>
    `<a href="#${id}" class="${v === id ? 'on' : ''}" ${v === id ? 'aria-current="page"' : ''}>${icon(iconName)}${label}</a>`;
  app.innerHTML = `
    <main class="content">${DEMO ? demoBanner : ''}${VIEWS[v]()}${versionTag}</main>
    <nav class="tabs">${tab('today', 'home', 'Today')}${tab('history', 'calendar_month', 'History')}${tab('insights', 'insights', 'Insights')}</nav>`;
}

// ── wiring ──────────────────────────────────────────────────

app.addEventListener('click', e => {
  const t = e.target.closest('[data-log],[data-action],[data-edit],[data-range],[data-welcome]');
  if (!t) return;
  const d = t.dataset;
  if (d.log) return quickLog(d.log);
  if (d.edit) return openEdit(d.edit);
  if (d.range) { state.historyRange = d.range; return render(); }
  if (d.welcome) { state.welcome = d.welcome; state.formError = ''; return render(); }
  if (d.action === 'accident') { state.accidentOpen = !state.accidentOpen; return render(); }
  if (d.action === 'add') return openAdd();
  if (d.action === 'end-crate') return endCrateNow();
  if (d.action === 'theme') return toggleTheme();
  if (d.action === 'signout') return signOut();
});

app.addEventListener('submit', async e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  state.form = f;
  if (!/^[0-9]{4}$/.test(f.pin)) { state.formError = 'The PIN must be exactly 4 digits.'; return render(); }
  state.busy = true; state.formError = ''; render();
  try {
    if (e.target.dataset.form === 'start') await db.createHousehold(f);
    else await db.joinHousehold(f);
    await enterHousehold();
    state.form = {};
    history.replaceState(null, '', '#today');
  } catch (err) {
    state.formError = err.message;
  }
  state.busy = false;
  render();
});

// ── day / night mode (per phone) ───────────────────────────

const isDark = () => document.documentElement.dataset.theme === 'dark';

function toggleTheme() {
  const t = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]').content = t === 'dark' ? '#171614' : '#faf8f5';
  try { localStorage.setItem('theme', t); } catch { /* private mode: just don't remember */ }
  render();
}

async function signOut() {
  if (!confirm("Sign out on this phone? You'll need the household name and PIN to get back in.")) return;
  stopLive?.();
  stopLive = null;
  await db.signOut();
  Object.assign(state, { household: null, puppy: null, me: null, members: [], events: [], welcome: 'choose' });
  history.replaceState(null, '', location.pathname);
  render();
}

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
document.addEventListener('visibilitychange', refresh);
// Backup for instant updates (e.g. after a dropped connection), and keeps "X min ago" current.
setInterval(refresh, 60000);
// Keep the crate timer current between refreshes.
setInterval(() => document.querySelectorAll('[data-since]').forEach(el => { el.textContent = elapsed(el.dataset.since); }), 15000);

async function boot() {
  // Shareable shortcut: …/project-lucy/#demo → …/project-lucy/?demo
  if (location.hash === '#demo') return location.replace(`${location.pathname}?demo`);
  if (DEMO) demoDb.reset();
  if (!db.configured) {
    app.innerHTML = `<main class="content narrow"><div class="empty-card">
      <p><b>Almost there.</b> Add your Supabase URL and publishable key to <code>js/config.js</code>. See the README.</p></div></main>`;
    return;
  }
  try {
    const h = await db.loadHousehold();
    if (h) await useHousehold(h);
  } catch (err) {
    app.innerHTML = `<main class="content narrow"><div class="empty-card"><p><b>Couldn't connect.</b> ${esc(err.message)}</p>
      <button class="btn primary" onclick="location.reload()">Try again</button></div></main>`;
    return;
  }
  render();
}

boot();
