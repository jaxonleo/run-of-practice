-- Free / Pro / Organization packaging, Phase A part 3 of 4: retire the
-- rostered 'helper' staff role and merge it into assistant_coach
-- (handoff decision 2: every rostered coach is an assistant; "helper"
-- now means only a parent on an anonymous link).
--
-- NOT behavior-neutral, unlike what the handoff assumed. can_coach_team
-- only admits head_coach/assistant_coach, so a rostered helper could not
-- start or join a live session, toggle Setup presence, create preview or
-- helper links, or record benchmarks. Every migrated helper gains those
-- rights. Jax confirmed the merge anyway on 2026-10-14. Archived rows are
-- migrated too so the constraint can drop 'helper' outright (a revived row
-- comes back as an assistant). No function or policy compares role to
-- 'helper' (checked on staging), so the CHECK constraints are the only
-- places the value lives.
--
-- Anonymous helpers (HelperView, /live/:token, session_access_tokens
-- scopes helper_read/helper_attendance, "Helper" note author labels) are a
-- different thing and are untouched.

do $$
declare
  v_staff integer;
  v_invites integer;
begin
  update public.team_staff set role = 'assistant_coach' where role = 'helper';
  get diagnostics v_staff = row_count;
  update public.team_invites set role = 'assistant_coach' where role = 'helper';
  get diagnostics v_invites = row_count;
  raise notice 'helper role merge: % team_staff row(s) and % team_invites row(s) moved to assistant_coach', v_staff, v_invites;
end;
$$;

alter table public.team_staff drop constraint team_staff_role_check;
alter table public.team_staff add constraint team_staff_role_check
  check (role in ('head_coach', 'assistant_coach'));

alter table public.team_invites drop constraint team_invites_role_check;
alter table public.team_invites add constraint team_invites_role_check
  check (role in ('head_coach', 'assistant_coach'));
