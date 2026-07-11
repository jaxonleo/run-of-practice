-- Default skill_tags per coach (not true 'global' rows) -- the update/delete
-- RLS policy on skill_tags only lets a coach manage their OWN scope='coach'
-- rows (skill_tags_update_manage), so a real scope='global' default could
-- never be individually archived by one coach without hiding it for every
-- other coach too. Seeding a personal scope='coach' copy for each coach
-- sidesteps that entirely: it reuses the existing, already-correct
-- add/archive machinery (createSkillTag/archiveSkillTag), and each coach's
-- edits are fully their own from the start.
--
-- Only Baseball and Basketball have skill_categories today (see
-- 20260707090000_seed_skill_categories.sql) -- this seeds real starter tags
-- for those, not placeholder junk. Expandable the same way when more sports
-- get categories.
create function public.seed_default_skill_tags_for_coach(p_coach_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat record;
  v_name text;
  v_names text[];
begin
  for v_cat in select id, sport, name from public.skill_categories loop
    v_names := case v_cat.sport || ':' || v_cat.name
      when 'Baseball:Hitting' then array['Bat path','Timing / pitch recognition','Contact to all fields','Two-strike approach']
      when 'Baseball:Fielding' then array['Glove work / fundamentals','First-step reads','Footwork on ground balls','Pop-up communication']
      when 'Baseball:Pitching' then array['Mechanics / delivery','Command','Pitch mix','Pickoff moves']
      when 'Baseball:Throwing' then array['Arm action','Accuracy','Crow hops / transfers','Long toss']
      when 'Baseball:Baserunning' then array['Leads and reads','First-to-third','Sliding technique','Stealing bags']
      when 'Baseball:Conditioning' then array['Speed / sprint work','Agility','Strength','Endurance']
      when 'Baseball:Team Play' then array['Cutoffs and relays','Situational awareness','Communication','Bunt defense']
      when 'Basketball:Shooting' then array['Form / mechanics','Catch-and-shoot','Off the dribble','Free throws']
      when 'Basketball:Ball Handling' then array['Dribble control','Change of direction','Weak-hand development','Pressure handling']
      when 'Basketball:Passing' then array['Chest / bounce pass','Court vision','Passing off the dribble','Entry passes']
      when 'Basketball:Defense' then array['On-ball defense','Help defense','Closeouts','Screen navigation']
      when 'Basketball:Rebounding' then array['Boxing out','Positioning','Put-backs','Long rebounds']
      when 'Basketball:Conditioning' then array['Speed / sprint work','Agility','Strength','Endurance']
      when 'Basketball:Team Play' then array['Spacing','Ball movement','Transition offense','Communication']
      else array[]::text[]
    end;
    foreach v_name in array v_names loop
      insert into public.skill_tags (category_id, scope, owner_user_id, name)
      select v_cat.id, 'coach', p_coach_id, v_name
      where not exists (
        select 1 from public.skill_tags
        where category_id = v_cat.id and owner_user_id = p_coach_id and name = v_name
      );
    end loop;
  end loop;
end;
$$;

-- Callable directly too (not just via the trigger below) so the client can
-- top up a coach's tags after a later migration adds categories/tags for a
-- new sport -- idempotent via the NOT EXISTS check above, safe to call
-- repeatedly.
grant execute on function public.seed_default_skill_tags_for_coach(uuid) to authenticated;

create function public.seed_default_skill_tags_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_skill_tags_for_coach(new.id);
  return new;
end;
$$;

create trigger on_profile_created_seed_skill_tags
  after insert on public.profiles
  for each row execute function public.seed_default_skill_tags_trigger();

-- Backfill for coaches who signed up before this migration.
do $$
declare r record;
begin
  for r in select id from public.profiles loop
    perform public.seed_default_skill_tags_for_coach(r.id);
  end loop;
end $$;
