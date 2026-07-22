-- Real gap found live: org_invites never emailed anyone. Fires the
-- notify-org-invite edge function (deployed separately, not via SQL) on
-- every new pending invite -- and on any update that leaves the row
-- pending too (a re-invite via org_invite_coach's ON CONFLICT DO UPDATE
-- path, e.g. changing the role before it's accepted), so a role change
-- re-sends the email. Excludes every other transition (accepted/declined/
-- cancelled all set status to something other than 'pending', so the WHEN
-- clause alone keeps this from re-firing on those).
--
-- Reuses notify-team-staff-added's exact same webhook secret (vault entry
-- 'team_staff_notify_webhook_secret' / function secret WEBHOOK_SECRET) --
-- both are already project-wide, shared across every deployed function, so
-- there's no reason to mint a second one for what's functionally the same
-- "trusted internal pg_net caller" gate.
create function public.notify_org_invite_created()
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
      url := 'https://bepoojcbizxhqadrytjq.functions.supabase.co/notify-org-invite',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
      body := jsonb_build_object('invite_id', new.id)
    );
  exception when others then
    raise warning 'notify_org_invite_created failed to enqueue for invite %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create trigger on_org_invite_created_notify
  after insert or update on public.org_invites
  for each row
  when (new.status = 'pending')
  execute function public.notify_org_invite_created();
