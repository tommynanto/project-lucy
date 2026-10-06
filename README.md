# Project Lucy – Puppy Tracker

A shared, phone-friendly log of a puppy's potty breaks and meals for one household.

- **Website:** plain HTML/CSS/JavaScript, hosted on GitHub Pages (no build step).
- **Data:** Supabase (Postgres + anonymous sign-in + Row Level Security).
- **Joining:** households are found by **name + 4-digit PIN**. No email or password.

## One-time setup (~5 minutes)

### 1. Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query**: paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
3. **Authentication → Sign In / Providers**: turn on **Allow anonymous sign-ins** and save.
4. Copy two values:
   - **Project URL**: Project Settings → Data API (looks like `https://abcd1234.supabase.co`)
   - **Publishable key** (or the legacy **anon** key): Project Settings → API Keys

### 2. Config

Put both values in [`js/config.js`](js/config.js). These are safe to commit: the publishable key is meant to be public, and the database rules only let people see their own household's data.

**Never** put the `service_role` / secret key anywhere in this repo.

### 3. GitHub Pages

1. Create a repo named `project-lucy` and push these files to `main`.
2. Repo **Settings → Pages → Build and deployment**: Source **Deploy from a branch**, branch **main**, folder **/ (root)**.
3. After a minute the site is at `https://YOUR-USERNAME.github.io/project-lucy/`.

## Using it

- **First person:** open the site → *Start a new household* → household name, PIN, puppy, your name.
- **Everyone else:** open the site → *Join a household* → same household name + PIN, plus their own name.
- On iPhone, open the site in Safari → Share → **Add to Home Screen**. The home-screen app keeps its own sign-in, so join from inside it once.
- If a phone gets signed out (new phone, cleared browser data), just join again with the name + PIN.
- The PIN is visible to members under the ⚙︎ on the Today screen.

## Demo mode

**Try the demo** on the welcome screen (or link straight to `https://tommynanto.github.io/project-lucy/?demo`) opens a made-up week for a puppy called Biscuit. It runs entirely in the visitor's browser from `js/demo-db.js`: nothing is sent to Supabase, and every visit starts from the same clean week.

## Running locally

Any static server works, e.g.:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## How it fits together

| File | What it does |
|---|---|
| `supabase/schema.sql` | Tables, access rules (RLS), `create_household` / `join_household` functions |
| `js/config.js` | Supabase URL + publishable key |
| `js/db.js` | Every call to Supabase |
| `js/demo-db.js` | Demo mode: same interface as `db.js`, with a generated week of data in memory |
| `js/logo.js` | The golden retriever sketch on the welcome screen |
| `js/events.js` | Event kinds, labels, date/time helpers |
| `js/app.js` | Screens (Today, History, Insights, Household, welcome) and quick logging |
| `js/sheet.js` | Add / edit / delete sheet with the 15-minute time picker |
| `js/insights.js` | Simple statistics, each shown only once there's enough data |

**Data model.** Each log entry is one row in `events` with:
- `event_type`: `potty`, `meal` or `crate`
- `event_subtype`: `pee`, `poop`, `both`, `accident_pee`, `accident_poop`, or a meal label
- `occurred_at`: when it happened (the start, for crate time)
- `ended_at`: crate time only; empty while the puppy is still in the crate
- `created_at`: when it was entered

Logging any potty break or meal automatically ends crate time.

**Instant updates.** Each phone subscribes to changes in `events` through Supabase Realtime (enabled by the last part of `schema.sql`), so an entry made on one phone appears on the others within a second. The app also re-checks once a minute and whenever it's reopened, in case the connection dropped.

**Adding a new event type later:**
1. Extend the `events_type_subtype` check in the database.
2. Add the kind to `KINDS` in `js/events.js`.
3. Add a button.

**Resetting a household PIN** (in the SQL Editor):

```sql
update households set pin = '5678' where name = 'The Smiths';
```
