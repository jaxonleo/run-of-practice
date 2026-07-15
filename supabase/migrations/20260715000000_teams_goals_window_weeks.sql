-- Goals feature (ROP-Goals-TeamNav-Handoff.md §2.1). Per-team trailing/lookahead
-- window (in weeks) used by get_team_goal_report for both the planned and
-- actual legs. Bare column on teams, matching the existing timezone/
-- color_primary precedent -- no settings table (D8, deferred).
alter table public.teams
  add column goals_window_weeks int not null default 4
    constraint teams_goals_window_weeks_range check (goals_window_weeks between 1 and 12);

-- No RLS/grant change needed: teams_update_manage (can_manage_team, whole-row
-- USING clause, no column restriction) already covers this new column, and
-- teams already has select/insert/update granted to authenticated.
