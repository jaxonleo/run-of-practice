-- Per-player handedness. Sport-conditional at the app layer (e.g. a
-- football roster never shows "bats"), so both columns stay generic and
-- nullable rather than sport-specific tables. bats covers the switch-hitter
-- case ('S'); throws does not since throwing ambidextrously isn't a thing
-- coaches track.
alter table public.players add column bats text check (bats in ('L', 'R', 'S'));
alter table public.players add column throws text check (throws in ('L', 'R'));
