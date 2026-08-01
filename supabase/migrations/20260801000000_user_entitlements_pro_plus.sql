-- Adds Pro+ as a valid plan_type, per a follow-up to the pricing brief
-- (2026-08-01): Pro+ delegates practice planning to one assistant per team
-- and grants 2 concurrent live practices, priced above Pro. Keeping this
-- constraint in sync with src/entitlements.js's PLAN_LIMITS on purpose --
-- this project has already been bitten once by a client config and a DB
-- definition silently drifting apart (team_goals/skill_tag_id, see
-- BUILD-STATUS's Decision History), and a plan_type the app can set but the
-- database rejects would be exactly that class of bug.
--
-- Looks up the existing check constraint by inspecting pg_constraint rather
-- than assuming Postgres's default auto-generated name -- no local/Docker
-- environment in this setup to verify the real name against beforehand, so
-- this is written to be correct regardless of what it actually is.
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'user_entitlements'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%plan_type%'
  loop
    execute format('alter table public.user_entitlements drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.user_entitlements add constraint user_entitlements_plan_type_check
  check (plan_type in ('free', 'pro', 'pro_plus'));
