-- Real bug found live testing: a head coach could remove their own
-- team_staff row from the Coaches list (App.jsx's RostersTab renders the
-- same ellipsis "Remove" -> archiveStaff() option on every row a manager
-- can see, including their own). archiveStaff is a bare client-side
-- .update() gated only by team_staff_update_manage's can_manage_team check
-- -- nothing stops a head coach (who always passes that check on their own
-- team) from archiving themselves. Mirrors the stance leave_team already
-- takes for team owners ("team owners cannot leave their own team") but
-- closes it at the table level, not just in the one RPC, since
-- archiveStaff never went through leave_team in the first place.
-- Deliberately scoped to role = 'head_coach' and the caller's own row only
-- -- leave_team's existing self-archive path for assistants/helpers (a
-- real, intended action) still works untouched.
create or replace function public.prevent_head_coach_self_removal()
returns trigger
language plpgsql
as $$
begin
  if new.archived_at is not null and old.archived_at is null
     and old.role = 'head_coach' and old.user_id = auth.uid() then
    raise exception 'head coaches cannot remove themselves from their own team roster';
  end if;
  return new;
end;
$$;

create trigger before_team_staff_archive_block_self_head_coach
before update on public.team_staff
for each row execute function public.prevent_head_coach_self_removal();
