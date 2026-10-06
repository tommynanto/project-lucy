// Bottom sheet for adding an event in the past, or editing / deleting one.
import { KINDS, kindIcon, icon, MEAL_LABELS, kindOf, toDateInput, toTimeInput, fromInputs, startOfDay, slotLabel, cap, esc } from './events.js';

const KIND_ORDER = ['pee', 'poop', 'both', 'meal', 'crate', 'nothing', 'accident_pee', 'accident_poop'];
const root = () => document.getElementById('sheet-root');
let s = null;

export function openSheet({ event = null, onSave, onDelete }) {
  const at = event ? new Date(event.occurred_at) : new Date();
  s = {
    event, onSave, onDelete,
    kind: event ? kindOf(event) : null,
    label: event?.event_type === 'meal' ? event.event_subtype : null,
    amount: event?.amount ?? '',
    date: toDateInput(at),
    time: toTimeInput(at),
    endTime: event?.ended_at ? toTimeInput(new Date(event.ended_at)) : '',   // crate time only; '' = still going
    error: '',
    busy: false,
  };
  document.body.classList.add('no-scroll');
  document.addEventListener('keydown', onKey);
  render();
}

export function closeSheet() {
  s = null;
  root().innerHTML = '';
  document.body.classList.remove('no-scroll');
  document.removeEventListener('keydown', onKey);
}

const onKey = e => { if (e.key === 'Escape') closeSheet(); };
const pad = n => String(n).padStart(2, '0');

function slotsHTML() {
  const now = new Date();
  const isToday = s.date === toDateInput(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const out = [];
  // Every 15 minutes, newest first, so recent times are right at the top.
  for (let t = 23 * 60 + 45; t >= 0; t -= 15) {
    if (isToday && t > nowMin) continue;
    const v = `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
    out.push(`<button type="button" class="slot${v === s.time ? ' on' : ''}" data-time="${v}">${slotLabel(Math.floor(t / 60), t % 60)}</button>`);
  }
  return out.join('');
}

function render() {
  const prevScroll = root().querySelector('.sheet-scroll')?.scrollTop ?? 0;
  const now = new Date();
  const today = toDateInput(now), yesterday = toDateInput(startOfDay(now, -1));
  const editing = !!s.event;
  const chip = (attr, val, on, text) =>
    `<button type="button" class="chip${on ? ' on' : ''}" ${attr}="${val}">${text}</button>`;

  root().innerHTML = `
    <div class="sheet-backdrop" data-close></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${editing ? 'Edit event' : 'Add event'}">
      <div class="sheet-head">
        <h2>${editing ? 'Edit event' : 'Add event'}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Close">${icon('close')}</button>
      </div>
      <div class="sheet-scroll">
        <div class="field-label">What happened?</div>
        <div class="chips">
          ${KIND_ORDER.map(k => chip('data-kind', k, s.kind === k, `${kindIcon(k)} ${KINDS[k].label}`)).join('')}
        </div>
        ${s.kind === 'meal' ? `
          <div class="chips">
            ${chip('data-label', '', !s.label, 'No label')}
            ${MEAL_LABELS.map(l => chip('data-label', l, s.label === l, cap(l))).join('')}
          </div>
          <input class="text-input" id="f-amount" placeholder="Amount (optional), e.g. 1 cup" value="${esc(s.amount)}" autocomplete="off">
        ` : ''}

        <div class="field-label">${s.kind === 'crate' ? 'Started' : 'When?'}</div>
        <div class="chips">
          ${chip('data-day', today, s.date === today, 'Today')}
          ${chip('data-day', yesterday, s.date === yesterday, 'Yesterday')}
          <input type="date" id="f-date" class="chip-input${s.date !== today && s.date !== yesterday ? ' on' : ''}" value="${s.date}" max="${today}" aria-label="Other date">
        </div>
        <div class="time-row">
          <input type="time" id="f-time" class="text-input" value="${s.time}" aria-label="Exact time">
          <button type="button" class="chip" data-now>Now</button>
        </div>
        ${s.kind === 'crate' ? `
          <div class="field-label">Ended</div>
          <div class="time-row">
            <input type="time" id="f-end" class="text-input" value="${s.endTime}" aria-label="End time">
            ${chip('data-still', '1', !s.endTime, 'Still in crate')}
          </div>` : ''}
        <div class="slots" aria-label="Pick a time">${slotsHTML()}</div>
      </div>
      ${s.error ? `<p class="form-error">${esc(s.error)}</p>` : ''}
      <div class="sheet-foot">
        ${editing ? '<button type="button" class="btn danger" data-delete>Delete</button>' : ''}
        <button type="button" class="btn primary" data-save ${s.busy ? 'disabled' : ''}>${s.busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>`;

  root().querySelector('.sheet-scroll').scrollTop = prevScroll;
}

async function save() {
  if (!s.kind) return showError('Pick what happened.');
  if (!s.date || !s.time) return showError('Pick a date and time.');
  const at = fromInputs(s.date, s.time);
  if (at - new Date() > 5 * 60000) return showError('That time is in the future.');

  const k = KINDS[s.kind];
  const isMeal = k.type === 'meal';
  let endedAt = null;
  if (k.type === 'crate' && s.endTime) {
    const end = fromInputs(s.date, s.endTime);
    if (end < at) end.setDate(end.getDate() + 1);   // e.g. 9:30 PM → 6:15 AM overnight
    if (end - new Date() > 5 * 60000) return showError('The end time is in the future.');
    endedAt = end.toISOString();
  }
  const fields = {
    event_type: k.type,
    event_subtype: isMeal ? s.label : k.subtype,
    amount: isMeal && s.amount.trim() ? s.amount.trim() : null,
    occurred_at: at.toISOString(),
    ended_at: endedAt,
  };
  await run(() => s.onSave(fields));
}

async function remove() {
  if (!confirm('Delete this event?')) return;
  await run(() => s.onDelete());
}

async function run(fn) {
  s.busy = true; s.error = ''; render();
  try {
    await fn();
    closeSheet();
  } catch (err) {
    if (!s) return;
    s.busy = false;
    showError(err.message || 'Something went wrong.');
  }
}

function showError(msg) { s.error = msg; render(); }

document.addEventListener('click', e => {
  if (!s) return;
  const t = e.target.closest('[data-close],[data-kind],[data-label],[data-day],[data-time],[data-now],[data-still],[data-save],[data-delete]');
  if (!t || !root().contains(t)) return;
  const d = t.dataset;
  if ('close' in d) return closeSheet();
  if ('save' in d) return save();
  if ('delete' in d) return remove();
  if ('kind' in d) { s.kind = d.kind; if (d.kind !== 'meal') s.label = null; }
  if ('label' in d) s.label = d.label || null;
  if ('day' in d) { s.date = d.day; s.error = ''; return render(); }
  if ('time' in d) s.time = d.time;
  if ('still' in d) s.endTime = '';
  if ('now' in d) { const n = new Date(); s.date = toDateInput(n); s.time = toTimeInput(n); }
  s.error = '';
  render();
});

document.addEventListener('input', e => {
  if (s && e.target.id === 'f-amount') s.amount = e.target.value;
});

document.addEventListener('change', e => {
  if (!s) return;
  if (e.target.id === 'f-date' && e.target.value) { s.date = e.target.value; render(); }
  if (e.target.id === 'f-time' && e.target.value) { s.time = e.target.value; render(); }
  if (e.target.id === 'f-end') { s.endTime = e.target.value; render(); }
});
