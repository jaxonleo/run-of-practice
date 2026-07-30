-- Same bug class as practice_series.created_by (20260730050000), found the
-- same way: a real account deletion blocked by a FK with no ON DELETE
-- action. organizations.created_by was already nullable but had no ON
-- DELETE behavior at all (default RESTRICT), unlike every other
-- actor-identity column in this schema (nullable + ON DELETE SET NULL --
-- see notes.created_by's "historical practice truth that should outlive
-- the author's account" convention). A director's account should be
-- deletable without being blocked by an org they created but no longer
-- need reference to.
alter table public.organizations drop constraint organizations_created_by_fkey;
alter table public.organizations add constraint organizations_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
