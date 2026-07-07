-- Idempotency ledger: every mutating live-session action (advance, pause,
-- take control, etc.) submits a client-generated operation_id. Before
-- applying the action, check whether this operation_id has been seen
-- before for this session -- if so, it's a retry (immediate or delayed/
-- out-of-order) and should be treated as already-applied, not reprocessed.
-- This is a full ledger, not just a "last operation" column, specifically
-- so a delayed retry arriving AFTER a later operation already succeeded is
-- still caught, not just the most recent duplicate.
create table public.session_operations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.practice_live_sessions(id) on delete cascade,
  operation_id uuid not null,
  submitted_by uuid not null references public.profiles(id),
  action_type text not null,
  created_at timestamptz not null default now(),
  unique (session_id, operation_id)
);

comment on table public.session_operations is
  'Idempotency + audit ledger. The unique constraint on (session_id, operation_id) is what actually prevents double-processing -- inserting is the check.';

create index session_operations_session_id_idx on public.session_operations (session_id);
