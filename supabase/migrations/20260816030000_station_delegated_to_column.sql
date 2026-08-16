-- Direct feedback: reusing stations.team_staff_id ("who leads this
-- station live," a field that's existed since before this feature) to
-- also mean "who's delegated to design it" was confusing -- there was no
-- way to look at a station and tell which of the two you were setting,
-- and a head coach reassigning the live leader could accidentally change
-- who has editing rights too. Split into two genuinely separate concepts:
-- team_staff_id stays exactly what it always was (live leader, settable
-- pre-live as a convenience default, reassignable live via
-- updateStationLead, unrestricted -- any roster coach or a freeform
-- helper name, no editing implication). delegated_to is new: who's been
-- asked to plan this station's own drills/notes/equipment before
-- practice. Only a head coach sets it (through the normal Builder save,
-- same as team_staff_id), and only a can_build_practices-eligible coach
-- can be picked for it in Builder's own new "Delegate This Station" UI.
alter table public.stations add column delegated_to uuid references public.team_staff(id) on delete set null;

comment on column public.stations.delegated_to is
  'team_staff.id of the coach asked to plan this station''s own content, distinct from team_staff_id (who leads it live). Set only by the head coach in Builder, checked by update_station_content as the actual write-access gate.';
