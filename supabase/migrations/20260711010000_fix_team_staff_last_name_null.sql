-- Bug found empirically (2026-07-11): profiles.last_name is optional (the
-- name-collection screen labels it "Last name (optional)"), but
-- team_staff.last_name is NOT NULL, same as players.last_name -- the rest
-- of the app already handles that by falling back to '' at the write site
-- (see createPlayer in supabase.js), but handle_new_team_head_coach copied
-- profiles.last_name straight through with no fallback. Any coach who
-- signed up without a last name got a NOT NULL violation on their very
-- first team creation, and since triggers run in the same transaction as
-- the insert that fired them, the whole `teams` insert rolled back with
-- it -- team creation silently failed with no team ever appearing and no
-- error surfaced in the UI.
create or replace function public.handle_new_team_head_coach()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_name text;
  v_last_name text;
begin
  select first_name, last_name into v_first_name, v_last_name
  from public.profiles where id = new.owner_user_id;

  insert into public.team_staff (team_id, user_id, role, first_name, last_name)
  values (new.id, new.owner_user_id, 'head_coach', v_first_name, coalesce(v_last_name, ''));

  return new;
end;
$$;
