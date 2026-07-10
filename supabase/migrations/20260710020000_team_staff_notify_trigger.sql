-- Testing-round-1 addendum §2(e): fire the notify-team-staff-added edge
-- function (deployed separately, not via SQL) whenever a coach adds staff
-- to their team. head_coach rows are excluded -- those only ever come from
-- the (a) auto-head-coach trigger (team creator adding themselves), which
-- never needs a "you were added" email. Wrapped in the same
-- exception-handling resilience pattern as 20260704006200's user_events
-- fix so a Resend/network hiccup can never block the staff row itself --
-- though net.http_post is already fire-and-forget/async, so this mainly
-- guards against net.http_post itself failing to enqueue (e.g. pg_net
-- misconfigured), not against the eventual HTTP response.
--
-- The webhook secret itself is NOT in this file -- it's inserted directly
-- via vault.create_secret(<value>, 'team_staff_notify_webhook_secret') as
-- a one-off admin call, never committed to git. This migration only
-- references it by name. The edge function checks the same value via its
-- own WEBHOOK_SECRET function secret (also set out-of-band via the
-- Management API) -- this shared value is the only thing gating the
-- function's public URL, since verify_jwt is off (pg_net calls carry no
-- user JWT). Assumes the 'team_staff_notify_webhook_secret' vault entry
-- already exists by the time this trigger first fires.

create extension if not exists pg_net;

create function public.notify_team_staff_added()
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
      url := 'https://bepoojcbizxhqadrytjq.functions.supabase.co/notify-team-staff-added',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
      body := jsonb_build_object('staff_id', new.id)
    );
  exception when others then
    raise warning 'notify_team_staff_added failed to enqueue for staff %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create trigger on_team_staff_added_notify
  after insert on public.team_staff
  for each row
  when (new.role <> 'head_coach')
  execute function public.notify_team_staff_added();
