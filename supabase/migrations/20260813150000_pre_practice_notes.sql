-- "Pre-Practice Warmup": a coach-written note on what players should do if
-- they arrive before practice starts (stretch, grab a ball, whatever). Not
-- an activity -- deliberately a plain text field on the practice/template
-- itself rather than a row in practice_activities/template_activities, so
-- it structurally can't affect duration, drill count, skill tags, or the
-- live rotation/timer flow the way a real activity would. Shown on the
-- Practice Setup screen (under the countdown timer, above attendance) when
-- set; surfaced in Builder as an optional "component" the coach can add,
-- pinned to the top of the Run of Practice list, purely client-side.
alter table public.practices add column pre_practice_notes text;
alter table public.templates add column pre_practice_notes text;
