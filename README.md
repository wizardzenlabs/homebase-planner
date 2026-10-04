# Homebase

A personal planner with five tabs — Bills, House Projects, Personal Tasks, Travel Plans, Random Thoughts. Things due soon or overdue (within 3 days) are flagged urgent. No login — it's built for one person.

## Stack

Plain HTML/CSS/JS, no build step. Supabase (Postgres) for the data, loaded via a CDN script tag. Hosted on GitHub Pages. See `supabase/schema.sql` for the database schema.

## Ownership / transfer

This app is built to be handed off cleanly:

- **The code** (this repo) can be transferred to another GitHub account, or forked, independent of the data.
- **The data** lives entirely in a separate Supabase project, which can be transferred to another Supabase account independent of this repo (Supabase dashboard → Project Settings → Transfer project).

To fully hand this off to someone else: they create their own Supabase account, you transfer the project to them, then update `SUPABASE_URL` and `SUPABASE_KEY` in `app.js` if those values change (they usually don't on transfer — double check after). Once confirmed working, remove yourself as a project collaborator on their end.

## Daily digest email (not yet set up)

A scheduled check for urgent/due items, emailed once a day, needs a Supabase Edge Function + `pg_cron` — see the project chat history for the plan (Gmail SMTP + app password, no third-party email service required).
