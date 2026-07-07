-- Unlike teams, this isn't a confirmed active bug -- it's a latent one.
-- org_members_insert_admin currently requires the inserting user to already
-- be an org admin, meaning they already have their own pre-existing
-- organization_members row from earlier; RETURNING's self-referential
-- visibility check finds that older row and never needs to see the brand
-- new one. This only becomes a real, reachable bug the day a self-serve
-- invite-acceptance flow lets someone insert their OWN first membership row
-- and immediately needs to see it via RETURNING. Fixing now while it's
-- cheap, rather than waiting to rediscover it the hard way later.
--
-- select gets a direct, lookup-free "see my own row" branch (safe: no
-- privilege implications, just visibility). update is deliberately left
-- untouched -- unlike select, UPDATE only ever touches pre-existing rows,
-- so it was never at risk of the same timing issue, and adding a
-- user_id = auth.uid() bypass there would let any member edit their own
-- row -- including its role column. That would be a privilege escalation
-- bug, not a fix.

drop policy if exists "org_members_select" on public.organization_members;
create policy "org_members_select" on public.organization_members
  for select using (
    user_id = auth.uid()
    or public.is_org_member(organization_id)
  );
