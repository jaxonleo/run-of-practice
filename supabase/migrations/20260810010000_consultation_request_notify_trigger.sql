-- Real gap: a submitted consultation request (ConsultationRequestForm,
-- Settings > Account or the FAQ's anonymous path) just landed in the
-- feedback table with no alert -- Jax had no way to know a lead came in
-- short of periodically checking the table by hand. Fires the
-- notify-consultation-request edge function (deployed separately) on
-- every new feedback row whose message is a consultation request
-- specifically, not a plain "Send Feedback" submission from Home -- the
-- message body always starts with the literal marker
-- ConsultationRequestForm's own message-building writes.
--
-- Reuses the same 'team_staff_notify_webhook_secret' vault entry every
-- other notify-* trigger in this project already shares, rather than
-- minting a new one for what's functionally the same trusted-pg_net-
-- caller gate.
create function public.notify_consultation_request_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  begin
    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'team_staff_notify_webhook_secret';

    perform net.http_post(
      url := 'https://bepoojcbizxhqadrytjq.functions.supabase.co/notify-consultation-request',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
      body := jsonb_build_object('feedback_id', new.id)
    );
  exception when others then
    raise warning 'notify_consultation_request_created failed to enqueue for feedback %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create trigger on_feedback_consultation_created_notify
  after insert on public.feedback
  for each row
  when (new.message like 'Organization consultation request%')
  execute function public.notify_consultation_request_created();
