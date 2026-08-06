-- Direct feedback: a practice plan didn't record who built it -- a coach
-- reviewing a plan (or another coach on the team) had no way to see who
-- actually made it, or who last touched it if someone different edited it
-- afterward. created_by is set once at insert and never touched again;
-- last_edited_by is set on every save (insert or update) -- the two read
-- identically for a plan nobody's edited since, and diverge the moment a
-- second coach saves changes to it.
alter table public.practices add column created_by uuid references auth.users(id) on delete set null;
alter table public.practices add column last_edited_by uuid references auth.users(id) on delete set null;
