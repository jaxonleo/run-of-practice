-- "Published by {publisher} - {organization}" (Jax's call, 2026-07-19) needs
-- a second attribution field distinct from publisher_name -- today "Staff
-- Editor - Run of Practice" for the system catalogs, later a coach's own
-- name paired with their team/org (e.g. "9U - Elite Club") when a coach can
-- publish their own library as a catalog. Not reusing content_catalogs.name
-- for this -- that's the catalog's own display name ("Run of Practice:
-- Basketball Fundamentals"), a different string with a different job.
alter table public.content_catalogs add column organization_name text;
