# Project Lucy – Puppy Tracker

Static site (plain HTML/CSS/JS, no build step) on GitHub Pages: https://tommynanto.github.io/project-lucy/
Data in Supabase (anonymous sign-in + Row Level Security). The owner publishes by uploading changed files through the GitHub website, so every change must end with a list of exactly which files to upload and where.

## Rules for every change

- **Keep the demo in sync.** Demo mode (`?demo`, or the "Try the demo" link) runs the same app code with `js/demo-db.js` in place of `js/db.js`. UI changes appear in the demo automatically. Any change to the data — a new event type, column, field, or db.js function — must also be added to `js/demo-db.js` (its interface and `generateWeek()`), and checked in the demo.
- **Bump the version** (`VERSION` near the top of `js/app.js`) for every update that will be published.
- **Database changes are additive only.** Never ask the owner to re-run all of `supabase/schema.sql`. Give a small separate SQL snippet (add column / extend check constraint / new function), keep `schema.sql` updated to match, and never drop, rename, or delete data. Run SQL in Supabase before uploading site files that depend on it.
- **Test before publishing** in the browser preview: the demo (`?demo`) never touches Supabase and is the safe place to exercise features. The normal page uses the real Supabase project — don't create households or write data there without asking.
- `js/config.js` holds the Supabase URL (no path after `.supabase.co`) and the publishable key. Both are meant to be public. Never add a secret/service_role key anywhere.

## Layout

- `js/app.js` — screens, quick logging, crate timer, demo switch
- `js/db.js` — every Supabase call; `js/demo-db.js` — same interface, in-memory demo data
- `js/events.js` — event kinds, labels, icons, time helpers
- `js/sheet.js` — add/edit/delete sheet; `js/insights.js` — statistics (each needs a minimum amount of data)
- `js/logo.js` — golden retriever sketch; `icon.svg` / `icon-180.png` are the same drawing
- `supabase/schema.sql` — tables, RLS, create/join functions, realtime
