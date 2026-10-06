// All Supabase calls live here. The rest of the app never talks to Supabase directly.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const configured = !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_KEY.startsWith('YOUR-');

const sb = configured ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const FRIENDLY = {
  name_taken: 'That household name is already taken. Try another.',
  bad_pin: 'The PIN must be exactly 4 digits.',
  bad_credentials: "Couldn't find a household with that name and PIN.",
  not_signed_in: 'Sign-in failed. Please try again.',
};

function check(error) {
  if (!error) return;
  const key = Object.keys(FRIENDLY).find(k => error.message?.includes(k));
  throw new Error(key ? FRIENDLY[key] : error.message || 'Something went wrong.');
}

async function userId() {
  const { data } = await sb.auth.getSession();
  return data.session?.user.id ?? null;
}

// Visitors only get an (anonymous) account once they create or join a household.
async function ensureSignedIn() {
  if (await userId()) return;
  const { error } = await sb.auth.signInAnonymously();
  if (error) {
    throw new Error(error.message.includes('disabled')
      ? 'Anonymous sign-ins are turned off in Supabase (Authentication → Sign In / Providers).'
      : error.message);
  }
}

export async function createHousehold({ householdName, pin, puppyName, birthDate, memberName }) {
  await ensureSignedIn();
  const { error } = await sb.rpc('create_household', {
    p_household_name: householdName,
    p_pin: pin,
    p_puppy_name: puppyName,
    p_birth_date: birthDate || null,
    p_member_name: memberName,
  });
  check(error);
}

export async function joinHousehold({ householdName, pin, memberName }) {
  await ensureSignedIn();
  const { error } = await sb.rpc('join_household', {
    p_household_name: householdName,
    p_pin: pin,
    p_member_name: memberName,
  });
  check(error);
}

// Returns { me, household, puppy, members } or null if this phone isn't in a household yet.
export async function loadHousehold() {
  const uid = await userId();
  if (!uid) return null;

  const { data: mine, error } = await sb.from('household_members')
    .select('id, name, household_id')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(1);
  check(error);
  if (!mine.length) return null;
  const me = mine[0];

  const [h, p, m] = await Promise.all([
    sb.from('households').select('id, name, pin').eq('id', me.household_id).single(),
    sb.from('puppies').select('id, name, birth_date').eq('household_id', me.household_id)
      .order('created_at').limit(1).single(),
    sb.from('household_members').select('id, name').eq('household_id', me.household_id).order('created_at'),
  ]);
  check(h.error); check(p.error); check(m.error);
  return { me, household: h.data, puppy: p.data, members: m.data };
}

export async function loadMembers(householdId) {
  const { data, error } = await sb.from('household_members')
    .select('id, name').eq('household_id', householdId).order('created_at');
  check(error);
  return data;
}

export async function loadEvents(puppyId, since) {
  const { data, error } = await sb.from('events')
    .select('*')
    .eq('puppy_id', puppyId)
    .gte('occurred_at', since.toISOString())
    .order('occurred_at', { ascending: false });
  check(error);
  return data;
}

// Calls onChange whenever an event for this puppy is added, edited or deleted.
// Row Level Security still applies: you only hear about your own household's events.
// Returns a function that stops listening.
export function subscribeToEvents(puppyId, onChange) {
  const mine = { schema: 'public', table: 'events', filter: `puppy_id=eq.${puppyId}` };
  const channel = sb.channel(`events-${puppyId}`)
    .on('postgres_changes', { event: 'INSERT', ...mine }, onChange)
    .on('postgres_changes', { event: 'UPDATE', ...mine }, onChange)
    // Supabase can't filter deletes by column, so listen to all and just reload.
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'events' }, onChange)
    .subscribe();
  return () => sb.removeChannel(channel);
}

export async function addEvent(row) {
  const { data, error } = await sb.from('events').insert(row).select().single();
  check(error);
  return data;
}

export async function updateEvent(id, patch) {
  const { data, error } = await sb.from('events').update(patch).eq('id', id).select().single();
  check(error);
  return data;
}

export async function deleteEvent(id) {
  const { error } = await sb.from('events').delete().eq('id', id);
  check(error);
}

export async function signOut() {
  await sb.auth.signOut();
}
