-- Schema for the homebase-planner app.
-- Single table holds every tab (bills, house, tasks, travel, thoughts);
-- the "category" column is what separates them in the UI.

create extension if not exists pgcrypto;

create table items (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('bills','house','tasks','travel','thoughts')),
  title text not null,
  notes text,                        -- unused by the app; kept for old data, see checklist below
  checklist jsonb not null default '[]'::jsonb, -- house/tasks/travel/thoughts: [{text, done}, ...] -- numbered, checkable sub-items ("Activities" for travel)
  amount numeric,                    -- bills: amount owed. travel: budget.
  due_date date,                     -- bills/house/tasks: due date. travel: start date.
  end_date date,                     -- travel only
  recurrence text not null default 'none' check (recurrence in ('none','daily','weekly','monthly')),
  status text not null default 'active' check (status in ('active','paid','done')),
  priority smallint not null default 3 check (priority between 1 and 5), -- 1/3/5 = low/med/high for most tabs, full 1-5 stars for travel
  links jsonb not null default '[]'::jsonb,   -- house/travel: [{label, url}, ...]
  region text check (region in ('US','International')),   -- travel only
  city text,                                                -- travel only
  travel_status text check (travel_status in ('wishlist','planned','booked','been')), -- travel only
  lets_do_this boolean not null default false,              -- travel only
  manual_urgent boolean not null default false,              -- bills/house/tasks: force-urgent regardless of due date
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Personal Tasks with recurrence 'daily'/'weekly' are "Routines": they stay
-- status='active' forever and just roll their due_date forward each time
-- they're checked off, instead of moving into the done/history list.

create index items_category_idx on items (category);
create index items_due_date_idx on items (due_date);

alter table items enable row level security;

-- Single-user app with no login: allow all operations.
-- Security relies on the project URL + anon/publishable key not being shared
-- publicly, since there's no auth/RLS scoping to a specific user.
create policy "allow all" on items
  for all
  using (true)
  with check (true);

-- Daily digest email: credentials live in Supabase Vault (vault.create_secret),
-- never in this repo. get_digest_secrets() is a security-definer function that
-- only the service_role can call, used by the daily-digest Edge Function.
-- See supabase/functions/daily-digest/index.ts.
