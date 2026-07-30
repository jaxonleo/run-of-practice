-- Orgs were single-sport (organizations.sport, one nullable text column),
-- added 2026-07-22 for the org-edit screen's display. A rec league or club
-- spanning multiple sports (the whole reason this table exists separately
-- from teams) couldn't actually represent that. Replaced with a real array
-- column rather than keeping both -- two parallel sport fields is exactly
-- the kind of drift that caused the get_team_goal_report stale-column bug
-- earlier this session.
alter table public.organizations add column sports text[] not null default '{}';

update public.organizations set sports = array[sport] where sport is not null and sport <> '';

alter table public.organizations drop column sport;

comment on column public.organizations.sports is
  'Sports this org spans -- used to restrict/default a new team''s sport when created inside this org (client-side UX only, not RLS-enforced; sport is not a security dimension). Empty array = no restriction, same as the old null single-sport value.';
