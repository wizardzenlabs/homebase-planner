-- Schema for the homebase-planner app.
-- Single table holds every tab (bills, house, tasks, travel, thoughts);
-- the "category" column is what separates them in the UI.

create extension if not exists pgcrypto;

create table items (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('bills','house','tasks','travel','thoughts')),
  title text not null,
  notes text,
  amount numeric,       -- bills only
  due_date date,         -- bills/house/tasks: due date. travel: start date.
  end_date date,          -- travel only
  recurrence text not null default 'none' check (recurrence in ('none','monthly')),
  status text not null default 'active' check (status in ('active','paid','done')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

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
