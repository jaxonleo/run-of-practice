-- Purely additive, zero-behavior-change migration: documents the teams
-- ownership pattern directly on the schema (COMMENT ON), rather than only
-- in BUILD-STATUS. Written specifically to exercise the full new migration
-- pipeline end to end (§7 of the stability-and-environments handoff): dump,
-- staging dry-run, staging apply, staging click-through, then a guarded
-- production apply. No application code depends on this; safe by
-- construction, since COMMENT ON has no effect on reads, writes, or RLS.

-- teams already carries a comment (the season-model note below); COMMENT ON
-- replaces rather than appends, so this combines both rather than clobbering
-- the existing one -- checked live against staging before writing this.
comment on table public.teams is
  'Season model kept intentionally simple: sport + season_label + start/end date + timezone, no separate season/permanent-team hierarchy. timezone has no DB default on purpose -- the client should set it from the browser/device at creation time rather than us guessing one. Ownership: a team is either a coach''s personal team (owner_user_id set, organization_id null) or an org-managed team (organization_id set) -- never neither, per the team_has_owner check constraint. See BUILD-STATUS.md Working Conventions and the Organizations section for the full ownership model.';

comment on column public.teams.owner_user_id is
  'Set for a personal (non-org) team; the coach who created it and who the on_team_created_add_head_coach trigger auto-adds as head_coach. Null for an org-managed team.';

comment on column public.teams.organization_id is
  'Set for an org-managed team, created via org_create_team (which deliberately does not auto-add a head_coach row, unlike the personal-team trigger). Null for a personal team.';
