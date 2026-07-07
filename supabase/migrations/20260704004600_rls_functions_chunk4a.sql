-- A third authority tier, distinct from the existing two:
--   can_access_team   -- any team_staff role (including helper): viewing
--   can_manage_team   -- head_coach only: editing the practice/roster PLAN
--   can_coach_team    -- head_coach + assistant_coach (+ owner/org admin):
--                        live session CONTROL (start/pause/advance/take
--                        control). Broader than can_manage_team (an
--                        assistant coach should be able to run a live
--                        session even if they can't edit the practice plan
--                        itself), narrower than can_access_team (a
--                        registered helper can view and mark attendance,
--                        but shouldn't be able to take control of the
--                        timer).
create function public.can_coach_team(p_team_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.teams t
    where t.id = p_team_id
      and (
        t.owner_user_id = auth.uid()
        or (t.organization_id is not null and public.is_org_admin(t.organization_id))
        or exists (
          select 1 from public.team_staff ts
          where ts.team_id = t.id
            and ts.user_id = auth.uid()
            and ts.role in ('head_coach', 'assistant_coach')
            and ts.archived_at is null
        )
      )
  );
$$;

create function public.can_coach_practice(p_practice_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_coach_team(p.team_id) from public.practices p where p.id = p_practice_id;
$$;
-- can_access_practice already exists from chunk 3 (rls_functions_chunk3.sql)
-- -- reused below, not redefined here.

-- Lookups keyed on a live_session's id, used by every child table
-- (attendance, groups, activity log, operations) since they all reference
-- session_id, not team_id or practice_id directly.
create function public.can_access_session(p_session_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_access_team(p.team_id)
  from public.practice_live_sessions ls
  join public.practices p on p.id = ls.practice_id
  where ls.id = p_session_id;
$$;

create function public.can_coach_session(p_session_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_coach_team(p.team_id)
  from public.practice_live_sessions ls
  join public.practices p on p.id = ls.practice_id
  where ls.id = p_session_id;
$$;

-- The immutability guard: completed/abandoned sessions' historical tables
-- (attendance, groups, activity log) should accept no further writes.
-- Applied to INSERT/UPDATE on those tables, never to SELECT -- history
-- must remain readable regardless of session status.
create function public.is_session_active(p_session_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.practice_live_sessions ls
    where ls.id = p_session_id and ls.status = 'active'
  );
$$;
