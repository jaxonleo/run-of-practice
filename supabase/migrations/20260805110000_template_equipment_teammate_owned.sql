-- Confirmed live (direct RLS reproduction, rolled back): "new row violates
-- row-level security policy for table template_activity_equipment" -- an
-- assistant coach saving a completed practice as a template, where that
-- practice used equipment personally owned by the *head coach* (the
-- overwhelmingly common real case -- almost no equipment in this app is
-- actually assets.team_id-tagged, per a direct check), could never link
-- that equipment into their own new template. The previous migration
-- (20260805100000) only added a team_id match, which doesn't help here --
-- the asset itself is a plain personal asset (team_id null), just owned by
-- a *teammate*, not the template's own owner.
--
-- Extends both functions one step further: also allow an asset owned by
-- any other (non-archived) team_staff member of the template's own
-- default_team_id -- same "can use whatever this team's own coaches
-- already use" reasoning this session's can_use_location_for_team fix
-- already applied to scheduling. Equipment *visibility* into this
-- template's picker is a separate, already-correct concern (assets_select_
-- access has its own peer/org-sharing rules); this only governs whether an
-- already-selected asset (copied straight off the practice being
-- templated, never freely browsed) can be attached.
create or replace function public.can_link_asset_to_template_activity(p_template_activity_id uuid, p_asset_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    case
      when t.organization_id is not null then ast.organization_id = t.organization_id
      else (
        ast.owner_user_id = t.owner_user_id
        or (ast.organization_id is not null and public.is_org_member(ast.organization_id))
        or (t.default_team_id is not null and ast.team_id = t.default_team_id)
        or (t.default_team_id is not null and exists (
          select 1 from public.team_staff ts
          where ts.team_id = t.default_team_id and ts.user_id = ast.owner_user_id and ts.archived_at is null
        ))
      )
    end
  from public.template_activities ta
  join public.templates t on t.id = ta.template_id
  join public.assets ast on ast.id = p_asset_id
  where ta.id = p_template_activity_id;
$$;

create or replace function public.can_link_asset_to_template_station(p_station_id uuid, p_asset_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    case
      when t.organization_id is not null then ast.organization_id = t.organization_id
      else (
        ast.owner_user_id = t.owner_user_id
        or (ast.organization_id is not null and public.is_org_member(ast.organization_id))
        or (t.default_team_id is not null and ast.team_id = t.default_team_id)
        or (t.default_team_id is not null and exists (
          select 1 from public.team_staff ts
          where ts.team_id = t.default_team_id and ts.user_id = ast.owner_user_id and ts.archived_at is null
        ))
      )
    end
  from public.template_stations s
  join public.template_station_blocks b on b.id = s.template_station_block_id
  join public.template_activities ta on ta.id = b.template_activity_id
  join public.templates t on t.id = ta.template_id
  join public.assets ast on ast.id = p_asset_id
  where s.id = p_station_id;
$$;
