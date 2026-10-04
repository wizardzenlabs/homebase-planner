# Calm Mind App

Dasha's Daily Organizer — a personal planner with five tabs — Bills, House Projects, Personal Tasks, Travel Plans, Random Thoughts. Things due soon or overdue (within 3 days) are flagged urgent. No login — it's built for one person.

## Stack

Plain HTML/CSS/JS, no build step. Supabase (Postgres) for the data, loaded via a CDN script tag. Hosted on GitHub Pages. See `supabase/schema.sql` for the database schema.

## Ownership / transfer

This app is built to be handed off cleanly:

- **The code** (this repo) can be transferred to another GitHub account, or forked, independent of the data.
- **The data** lives entirely in a separate Supabase project, which can be transferred to another Supabase account independent of this repo (Supabase dashboard → Project Settings → Transfer project).

To fully hand this off to someone else: they create their own Supabase account, you transfer the project to them, then update `SUPABASE_URL` and `SUPABASE_KEY` in `app.js` if those values change (they usually don't on transfer — double check after). Once confirmed working, remove yourself as a project collaborator on their end.

## Daily digest email

Sent once a day (9am ET) via a Supabase Edge Function (`supabase/functions/daily-digest`) triggered by `pg_cron` + `pg_net`. Sends through Gmail SMTP using an app password — no third-party email service. Credentials live in Supabase Vault, never in this repo; see `get_digest_secrets()` in `supabase/schema.sql`.

The 9am time is pinned to a fixed UTC hour, so it drifts an hour across daylight saving twice a year — a one-line SQL update (`select cron.alter_job(...)`) fixes it.
