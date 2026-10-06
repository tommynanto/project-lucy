-- Puppy Tracker schema.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to read top to bottom: tables, then access rules (RLS), then the
-- two functions the website calls to create / join a household.

-- ─────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────

create table households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) between 1 and 60),
  -- 4-digit PIN used to join. Only members of the household can read it.
  pin        text not null check (pin ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now()
);
-- "The Smiths" and "the smiths " are the same household name.
create unique index households_name_unique on households (lower(trim(name)));

create table household_members (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  user_id      uuid references auth.users (id) on delete set null,
  name         text not null check (length(trim(name)) between 1 and 40),
  created_at   timestamptz not null default now(),
  unique (household_id, user_id)
);

create table puppies (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 40),
  birth_date   date,
  created_at   timestamptz not null default now()
);

create table events (
  id                  uuid primary key default gen_random_uuid(),
  puppy_id            uuid not null references puppies (id) on delete cascade,
  household_member_id uuid references household_members (id) on delete set null,
  event_type          text not null,
  event_subtype       text,
  amount              text,
  notes               text,
  occurred_at         timestamptz not null,           -- when it happened (start, for crate time)
  ended_at            timestamptz,                    -- crate time only: null while still in the crate
  created_at          timestamptz not null default now(), -- when it was entered
  updated_at          timestamptz not null default now(),
  -- To add a new kind of event later, extend this check.
  constraint events_type_subtype check (
    (event_type = 'potty' and event_subtype in ('pee', 'poop', 'both', 'accident_pee', 'accident_poop', 'nothing'))
    or
    (event_type = 'meal' and (event_subtype is null or event_subtype in ('breakfast', 'lunch', 'dinner', 'other')))
    or
    (event_type = 'crate' and event_subtype is null)
  ),
  constraint events_end_after_start check (ended_at is null or ended_at >= occurred_at)
);
create index events_puppy_time on events (puppy_id, occurred_at desc);

create function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger events_touch before update on events
  for each row execute function touch_updated_at();

-- ─────────────────────────────────────────────────────────────
-- Access rules: you can only see/change data for households you belong to
-- ─────────────────────────────────────────────────────────────

-- security definer so it can read household_members without recursing into
-- that table's own RLS policy.
create function is_member(hid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from household_members
    where household_id = hid and user_id = auth.uid()
  );
$$;

create function can_access_puppy(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from puppies p
    join household_members m on m.household_id = p.household_id
    where p.id = pid and m.user_id = auth.uid()
  );
$$;

alter table households        enable row level security;
alter table household_members enable row level security;
alter table puppies           enable row level security;
alter table events            enable row level security;

-- Households and members are created only through the functions below,
-- so there are no insert policies for them.
create policy "members read household" on households
  for select to authenticated using (is_member(id));

create policy "members read members" on household_members
  for select to authenticated using (is_member(household_id));

create policy "members read puppy" on puppies
  for select to authenticated using (is_member(household_id));

create policy "members update puppy" on puppies
  for update to authenticated using (is_member(household_id)) with check (is_member(household_id));

create policy "members read events" on events
  for select to authenticated using (can_access_puppy(puppy_id));

create policy "members add events" on events
  for insert to authenticated with check (
    can_access_puppy(puppy_id)
    and household_member_id in (select id from household_members where user_id = auth.uid())
  );

create policy "members edit events" on events
  for update to authenticated
  using (can_access_puppy(puppy_id)) with check (can_access_puppy(puppy_id));

create policy "members delete events" on events
  for delete to authenticated using (can_access_puppy(puppy_id));

-- ─────────────────────────────────────────────────────────────
-- Functions the website calls
-- ─────────────────────────────────────────────────────────────

create function create_household(
  p_household_name text,
  p_pin            text,
  p_puppy_name     text,
  p_birth_date     date,
  p_member_name    text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  hid uuid;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if p_pin !~ '^[0-9]{4}$' then raise exception 'bad_pin'; end if;
  if exists (select 1 from households where lower(trim(name)) = lower(trim(p_household_name))) then
    raise exception 'name_taken';
  end if;

  insert into households (name, pin) values (trim(p_household_name), p_pin) returning id into hid;
  insert into puppies (household_id, name, birth_date) values (hid, trim(p_puppy_name), p_birth_date);
  insert into household_members (household_id, user_id, name) values (hid, auth.uid(), trim(p_member_name));
  return hid;
end $$;

create function join_household(
  p_household_name text,
  p_pin            text,
  p_member_name    text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  hid uuid;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;

  select id into hid from households
  where lower(trim(name)) = lower(trim(p_household_name)) and pin = p_pin;

  -- Same error for wrong name or wrong PIN.
  if hid is null then raise exception 'bad_credentials'; end if;

  insert into household_members (household_id, user_id, name)
  values (hid, auth.uid(), trim(p_member_name))
  on conflict (household_id, user_id) do update set name = excluded.name;
  return hid;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Instant updates between phones (Supabase Realtime).
-- The access rules above still decide who receives which changes.
-- ─────────────────────────────────────────────────────────────
alter publication supabase_realtime add table events;

-- Only signed-in users (including anonymous sign-ins) may call these.
revoke execute on function create_household(text, text, text, date, text) from public, anon;
revoke execute on function join_household(text, text, text) from public, anon;
grant  execute on function create_household(text, text, text, date, text) to authenticated;
grant  execute on function join_household(text, text, text) to authenticated;
