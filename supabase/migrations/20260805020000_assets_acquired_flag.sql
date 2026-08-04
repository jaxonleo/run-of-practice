-- Direct feedback: "Add Drill Anyway" on the equipment-mismatch dialog used
-- to silently drop the unmatched equipment reference entirely -- a coach
-- copying a drill that calls for gear they don't have yet had no way to
-- see that gap again later, since nothing about the missing item survived
-- the copy. `acquired` lets a coach's own equipment pool distinguish "I
-- have this" from "I know I need this, haven't gotten it yet" -- default
-- true so every existing asset (all of them genuinely owned already) is
-- unaffected; only assets created via the new "Add Anyway" path get
-- acquired=false.
alter table public.assets add column acquired boolean not null default true;
