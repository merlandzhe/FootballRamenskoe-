-- FootballRamenskoe: Saturday 20:00-22:00, 350 RUB.
-- Run in Supabase SQL Editor once. No passwords or secret keys here.
create extension if not exists pgcrypto;

create table if not exists public.football_events (
  id uuid primary key default gen_random_uuid(),
  event_date date not null unique,
  start_time text not null default '20:00',
  end_time text not null default '22:00',
  price_rub integer not null default 350 check (price_rub > 0),
  created_at timestamptz not null default now()
);
create table if not exists public.football_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.football_events(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 40),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique(event_id, name)
);
create table if not exists public.payment_claims (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null unique references public.football_participants(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.football_events enable row level security;
alter table public.football_participants enable row level security;
alter table public.payment_claims enable row level security;
alter table public.admins enable row level security;

create or replace function public.is_football_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.admins where user_id = (select auth.uid())); $$;
revoke all on function public.is_football_admin() from public;
grant execute on function public.is_football_admin() to authenticated;

create or replace function public.valid_football_event(d date, s text, e text, p integer)
returns boolean language sql stable set search_path = ''
as $$ select extract(isodow from d) = 6 and d >= (now() at time zone 'Europe/Moscow')::date
  and s = '20:00' and e = '22:00' and p = 350; $$;
revoke all on function public.valid_football_event(date,text,text,integer) from public;
grant execute on function public.valid_football_event(date,text,text,integer) to anon, authenticated;

-- Drop policies from the earlier draft too, if any were created.
drop policy if exists "events readable by everyone" on public.football_events;
drop policy if exists "events createable by visitors" on public.football_events;
drop policy if exists "admins manage events" on public.football_events;
drop policy if exists "participants readable by everyone" on public.football_participants;
drop policy if exists "visitors can sign up" on public.football_participants;
drop policy if exists "admins manage participants" on public.football_participants;
drop policy if exists "visitors can see payment claims" on public.payment_claims;
drop policy if exists "visitors can claim payment" on public.payment_claims;
drop policy if exists "admins manage payment claims" on public.payment_claims;
drop policy if exists "admins can read admin roster" on public.admins;

create policy "events readable by everyone" on public.football_events
  for select to anon, authenticated using (true);
create policy "events createable by visitors" on public.football_events
  for insert to anon, authenticated
  with check (public.valid_football_event(event_date,start_time,end_time,price_rub));
create policy "admins manage events" on public.football_events
  for all to authenticated using (public.is_football_admin()) with check (public.is_football_admin());

create policy "participants readable by everyone" on public.football_participants
  for select to anon, authenticated using (true);
create policy "visitors can sign up" on public.football_participants
  for insert to anon, authenticated
  with check (paid_at is null and exists (
    select 1 from public.football_events e where e.id = event_id
    and public.valid_football_event(e.event_date,e.start_time,e.end_time,e.price_rub)
  ));
create policy "admins manage participants" on public.football_participants
  for all to authenticated using (public.is_football_admin()) with check (public.is_football_admin());

create policy "visitors can see payment claims" on public.payment_claims
  for select to anon, authenticated using (true);
create policy "visitors can claim payment" on public.payment_claims
  for insert to anon, authenticated with check (
    status = 'pending' and reviewed_at is null
    and exists (select 1 from public.football_participants p
      where p.id = participant_id and p.paid_at is null)
  );
create policy "admins manage payment claims" on public.payment_claims
  for all to authenticated using (public.is_football_admin()) with check (public.is_football_admin());

create policy "admins can read admin roster" on public.admins
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.football_events, public.football_participants, public.payment_claims, public.admins from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select, insert on public.football_events to anon, authenticated;
grant select, insert on public.football_participants to anon, authenticated;
grant select, insert on public.payment_claims to anon, authenticated;
grant select on public.admins to authenticated;
grant update, delete on public.football_events, public.football_participants, public.payment_claims to authenticated;

-- Later: create the organizer in Authentication > Users, then separately run:
-- insert into public.admins(user_id)
-- select id from auth.users where email = 'ORGANIZER_EMAIL_HERE';
