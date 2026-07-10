-- Landing-page/feedback addendum §3: a standalone feedback table, deliberately
-- not folded into user_events -- this is a coach's words, not a behavioral
-- log entry, and it needs its own read/triage story that user_events's
-- zero-policy design doesn't support.

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  contact_email text,
  message text not null,
  page_context text,
  status text not null default 'new' check (status in ('new', 'reviewed', 'resolved')),
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

-- Authenticated in-app submissions: same actor-identity enforcement pattern
-- used everywhere else in this schema (WITH CHECK against auth.uid()).
create policy feedback_insert_own on public.feedback
  for insert to authenticated
  with check (user_id = auth.uid());

-- A coach can see feedback THEY submitted, to confirm it went through --
-- never anyone else's. No update/delete policy: status triage is done
-- directly by Jax, not through the app.
create policy feedback_select_own on public.feedback
  for select to authenticated
  using (user_id = auth.uid());

grant select, insert on public.feedback to authenticated;

-- Anonymous marketing-page path: not a table grant (anon gets functions,
-- never table access, consistent throughout this schema) -- a narrow
-- security-definer RPC instead.
create function public.submit_public_feedback(
  p_email text,
  p_message text,
  p_page_context text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_email is null or p_email = '' then
    return jsonb_build_object('error', 'email_required');
  end if;
  insert into public.feedback (contact_email, message, page_context)
  values (p_email, p_message, p_page_context);
  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.submit_public_feedback(text, text, text) to anon;
