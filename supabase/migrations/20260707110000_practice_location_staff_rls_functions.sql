-- Compatibility checks for the new location_id/team_staff_id/sublocation_id
-- columns, mirroring the existing equipment/drill compatibility pattern.
-- Written to reference the row's own column VALUES passed as arguments
-- (not a lookup-by-own-id), so these are safe to use directly in
-- practice_activities'/templates' own INSERT/UPDATE policies without
-- risking the self-referential-RETURNING bug class (see
-- rop_actor_deletion_fk_gotcha memory / organizations_self_reference_fix).

create function public.can_access_sublocation(p_sublocation_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_access_location(sl.location_id)
  from public.sublocations sl where sl.id = p_sublocation_id;
$$;

-- A coach picking "who's running this drill" must pick from the SAME
-- team's staff roster as the practice itself -- never a different team's.
create function public.staff_belongs_to_practice_team(p_practice_id uuid, p_team_staff_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.team_staff ts
    join public.practices p on p.team_id = ts.team_id
    where p.id = p_practice_id and ts.id = p_team_staff_id
  );
$$;
