-- Real bug found live testing the new notify-consultation-request edge
-- function: service_role bypasses RLS but not base-table GRANTs (this
-- project's own recurring gotcha, previously hit for profiles and org_
-- invites/organizations) -- feedback's original migration only ever
-- granted select/insert to `authenticated`, so the function's service-
-- role client got a bare "feedback lookup failed" trying to read the row
-- it was just told to notify about.
grant select on public.feedback to service_role;
