-- Consultation form (ConsultationRequestForm) now accepts phone-only
-- submissions -- the client requires name + (email OR phone), not both.
-- The anonymous RPC path (used when the FAQ's consultation form is reached
-- signed out) previously hard-required p_email even when a phone number
-- was provided instead, which would silently reject a valid phone-only
-- lead with 'email_required'. Loosened to just require the message body
-- (which always carries whatever contact info was actually given), the
-- same non-requirement the authenticated submitFeedback path already had.
create or replace function public.submit_public_feedback(
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
  if p_message is null or trim(p_message) = '' then
    return jsonb_build_object('error', 'message_required');
  end if;
  insert into public.feedback (contact_email, message, page_context)
  values (nullif(p_email, ''), p_message, p_page_context);
  return jsonb_build_object('success', true);
end;
$$;
