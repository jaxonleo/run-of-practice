-- Real bug found investigating a Save-as-Template failure (visible red
-- "Something went wrong saving" error): can_link_asset_to_template_activity/
-- can_link_asset_to_template_station only ever accepted equipment owned
-- personally by the template's own owner, or shared via the same
-- organization -- never a *team-shared* asset (assets.team_id set, "any
-- team_staff/owner can see and use it regardless of org," per
-- can_link_asset_to_practice_activity's own comment when that case was
-- added for practices/stations, 20260704003000). A practice built with the
-- team's own shared equipment could always be saved and run as a practice,
-- but copying that exact same equipment into a template (which isn't
-- team-scoped, only coach/org-scoped) failed this check -- silently, since
-- replaceEquipment never checked its own insert's error before this
-- session's fix. Extended here the same way the practice-scoped functions
-- already are, using the template's own default_team_id (set at save time
-- to record which team the template was built for/from) as the team match.
create or replace function public.can_link_asset_to_template_activity(p_template_activity_id uuid, p_asset_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    case
      when t.organization_id is not null then ast.organization_id = t.organization_id
      else (
        ast.owner_user_id = t.owner_user_id
        or (ast.organization_id is not null and public.is_org_member(ast.organization_id))
        or (t.default_team_id is not null and ast.team_id = t.default_team_id)
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
      )
    end
  from public.template_stations s
  join public.template_station_blocks b on b.id = s.template_station_block_id
  join public.template_activities ta on ta.id = b.template_activity_id
  join public.templates t on t.id = ta.template_id
  join public.assets ast on ast.id = p_asset_id
  where s.id = p_station_id;
$$;
