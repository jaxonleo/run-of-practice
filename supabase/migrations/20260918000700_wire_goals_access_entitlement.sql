-- Entitlement architecture, Phase 3, gate 1 of 3: Goals & Insights.
--
-- Pre-Implementation Review tech-debt item: two independent, previously-
-- unreconciled answers to "can this person see Goals & Insights" existed --
-- can_view_goals_for_team (role-based: head coach or a build-delegate,
-- fifty-sixth session, actually enforced) and PLAN_LIMITS.goals/.insights
-- (plan-based, inert, now deleted). This folds them into a real AND rather
-- than picking one to silently win: a coach still needs the role (manage
-- or build-delegate) *and* the team's actual entitlement subject (its org,
-- or its personal owner -- never the calling coach's own plan) must
-- include goals.access.
--
-- create or replace preserves can_view_goals_for_team's OID/signature, so
-- every existing call site (get_team_goal_report and the other 3 Goals
-- RPCs, per the fifty-sixth session) picks this up automatically with no
-- other change needed -- the same technique this schema already used to
-- swap can_view_goals_for_team's own body in without touching callers.
create or replace function public.can_view_goals_for_team(p_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select (public.can_manage_team(p_team_id) or public.can_build_practice_for_team(p_team_id))
    and public.team_can_access_feature(p_team_id, 'goals.access');
$$;
