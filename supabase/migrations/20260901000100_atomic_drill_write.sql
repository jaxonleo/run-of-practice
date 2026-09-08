-- Atomic drill create/update, replacing the client-side
-- insert-row-then-sync-equipment-then-sync-tags sequence in
-- createDrill/updateDrill (supabase.js).
--
-- Why: a real production bug (AZBC 10U). createDrill inserts the
-- activity_library row FIRST, then links equipment. When the equipment
-- link failed RLS (see 20260901000000 for that root cause), the drill row
-- was already committed, the modal stayed open on a generic error with its
-- form state intact, and every retry produced another orphan row -- the
-- reporter ended up with ~5 near-identical drills, only the last of which
-- actually saved cleanly (after he removed the equipment). One transaction
-- means a failure leaves nothing behind and a retry starts clean.
--
-- SECURITY INVOKER (explicit): every insert/update/delete inside still
-- runs as the caller and still passes through the caller's own RLS --
-- activity_library_insert_manage / activity_library_update_manage,
-- activity_library_equipment_insert_manage (-> can_link_asset_to_activity),
-- drill_tags_insert_manage (-> can_link_tag_to_activity). This adds no new
-- privilege surface; it only makes the three existing writes atomic. An
-- RLS rejection anywhere raises and rolls the whole call back.
--
-- updated_at is left to the existing touch_activity_library_updated_at
-- BEFORE UPDATE trigger, matching what the client updateDrill does today
-- (it never sets updated_at itself).

create or replace function public.create_drill_with_equipment(
  p_owner_user_id uuid,
  p_name text,
  p_sport text,
  p_duration_minutes int,
  p_description text,
  p_coaching_points text,
  p_grouping text,
  p_num_groups int,
  p_equipment_asset_ids uuid[],
  p_skill_tag_ids uuid[]
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_drill_id uuid;
  v_position int;
begin
  if p_owner_user_id is null or auth.uid() is null or p_owner_user_id <> auth.uid() then
    raise exception 'not authorized';
  end if;
  if coalesce(nullif(trim(p_name), ''), '') = '' then
    raise exception 'drill name is required';
  end if;

  select coalesce(max(position) + 1, 0) into v_position
  from public.activity_library
  where owner_user_id = p_owner_user_id;

  insert into public.activity_library (
    owner_user_id, name, sport, duration_minutes, description,
    coaching_points, grouping, num_groups, position
  ) values (
    p_owner_user_id, p_name, coalesce(nullif(p_sport, ''), 'General'),
    p_duration_minutes, nullif(p_description, ''), nullif(p_coaching_points, ''),
    coalesce(nullif(p_grouping, ''), 'whole'), p_num_groups, v_position
  )
  returning id into v_drill_id;

  if p_equipment_asset_ids is not null and array_length(p_equipment_asset_ids, 1) is not null then
    insert into public.activity_library_equipment (activity_library_id, asset_id)
    select v_drill_id, x from (select distinct unnest(p_equipment_asset_ids) as x) s
    on conflict (activity_library_id, asset_id) do nothing;
  end if;

  if p_skill_tag_ids is not null and array_length(p_skill_tag_ids, 1) is not null then
    insert into public.drill_tags (activity_library_id, skill_tag_id)
    select v_drill_id, x from (select distinct unnest(p_skill_tag_ids) as x) s
    on conflict (activity_library_id, skill_tag_id) do nothing;
  end if;

  return v_drill_id;
end;
$$;

grant execute on function public.create_drill_with_equipment(uuid, text, text, int, text, text, text, int, uuid[], uuid[]) to authenticated;

-- Update counterpart. Same diff semantics as the client's
-- syncDrillEquipment/syncDrillTags: a NULL array means "leave this
-- relation untouched"; a non-null array (including an empty one) is the
-- full desired set -- add what's missing, remove what's no longer listed.
create or replace function public.update_drill_with_equipment(
  p_drill_id uuid,
  p_name text,
  p_sport text,
  p_duration_minutes int,
  p_description text,
  p_coaching_points text,
  p_grouping text,
  p_num_groups int,
  p_equipment_asset_ids uuid[],
  p_skill_tag_ids uuid[]
) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if coalesce(nullif(trim(p_name), ''), '') = '' then
    raise exception 'drill name is required';
  end if;

  update public.activity_library set
    name = p_name,
    sport = coalesce(nullif(p_sport, ''), 'General'),
    duration_minutes = p_duration_minutes,
    description = nullif(p_description, ''),
    coaching_points = nullif(p_coaching_points, ''),
    grouping = coalesce(nullif(p_grouping, ''), 'whole'),
    num_groups = p_num_groups
  where id = p_drill_id;

  if not found then
    -- row missing, or hidden from this caller by activity_library_update_manage
    raise exception 'not authorized';
  end if;

  if p_equipment_asset_ids is not null then
    delete from public.activity_library_equipment
    where activity_library_id = p_drill_id
      and not (asset_id = any (p_equipment_asset_ids));

    insert into public.activity_library_equipment (activity_library_id, asset_id)
    select p_drill_id, x from (select distinct unnest(p_equipment_asset_ids) as x) s
    on conflict (activity_library_id, asset_id) do nothing;
  end if;

  if p_skill_tag_ids is not null then
    delete from public.drill_tags
    where activity_library_id = p_drill_id
      and not (skill_tag_id = any (p_skill_tag_ids));

    insert into public.drill_tags (activity_library_id, skill_tag_id)
    select p_drill_id, x from (select distinct unnest(p_skill_tag_ids) as x) s
    on conflict (activity_library_id, skill_tag_id) do nothing;
  end if;
end;
$$;

grant execute on function public.update_drill_with_equipment(uuid, text, text, int, text, text, text, int, uuid[], uuid[]) to authenticated;
