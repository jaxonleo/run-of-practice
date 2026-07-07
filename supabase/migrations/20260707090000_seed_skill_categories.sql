-- Starter skill_categories taxonomy (Jax's call, 2026-07-07). skill_categories
-- is curated centrally with no app-writable INSERT policy by design, so this
-- has to land as a migration, not a runtime seed. Baseball is the August
-- launch sport; basketball included since it's the other sport actively
-- used in POC testing. Expandable/editable via further migrations later --
-- not meant to be exhaustive on day one.
insert into public.skill_categories (sport, name, sort_order) values
  ('Baseball', 'Hitting', 1),
  ('Baseball', 'Fielding', 2),
  ('Baseball', 'Pitching', 3),
  ('Baseball', 'Throwing', 4),
  ('Baseball', 'Baserunning', 5),
  ('Baseball', 'Conditioning', 6),
  ('Baseball', 'Team Play', 7),
  ('Basketball', 'Shooting', 1),
  ('Basketball', 'Ball Handling', 2),
  ('Basketball', 'Passing', 3),
  ('Basketball', 'Defense', 4),
  ('Basketball', 'Rebounding', 5),
  ('Basketball', 'Conditioning', 6),
  ('Basketball', 'Team Play', 7);
