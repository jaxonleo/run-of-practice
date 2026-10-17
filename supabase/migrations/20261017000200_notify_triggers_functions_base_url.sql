-- Fix (open since the staging stand-up): notify_team_invite,
-- notify_org_invite_created, and notify_consultation_request_created baked
-- production's functions URL into their SQL, so every environment built
-- from the migration folder emailed through production, and staging had to
-- be corrected by hand. They now read the per-environment Vault entry
-- functions_base_url, like notify_partner_application_created
-- (20261015000100). Each environment must have that entry
-- (e.g. https://<project-ref>.functions.supabase.co) before this runs, or
-- these emails are skipped with a warning; nothing else changes.

create or replace function public.notify_team_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_base text;
begin
  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'team_staff_notify_webhook_secret';
    select decrypted_secret into v_base from vault.decrypted_secrets where name = 'functions_base_url';
    if v_base is null then
      raise warning 'functions_base_url is not set in Vault; invite % not emailed', new.id;
      return new;
    end if;
    perform net.http_post(
      url := v_base || '/notify-team-staff-added',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
      body := jsonb_build_object('invite_id', new.id)
    );
  exception when others then
    raise warning 'notify_team_invite failed to enqueue for invite %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create or replace function public.notify_org_invite_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_base text;
begin
  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'team_staff_notify_webhook_secret';
    select decrypted_secret into v_base from vault.decrypted_secrets where name = 'functions_base_url';
    if v_base is null then
      raise warning 'functions_base_url is not set in Vault; invite % not emailed', new.id;
      return new;
    end if;
    perform net.http_post(
      url := v_base || '/notify-org-invite',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
      body := jsonb_build_object('invite_id', new.id)
    );
  exception when others then
    raise warning 'notify_org_invite_created failed to enqueue for invite %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create or replace function public.notify_consultation_request_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_base text;
begin
  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'team_staff_notify_webhook_secret';
    select decrypted_secret into v_base from vault.decrypted_secrets where name = 'functions_base_url';
    if v_base is null then
      raise warning 'functions_base_url is not set in Vault; feedback % not emailed', new.id;
      return new;
    end if;
    perform net.http_post(
      url := v_base || '/notify-consultation-request',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
      body := jsonb_build_object('feedback_id', new.id)
    );
  exception when others then
    raise warning 'notify_consultation_request_created failed to enqueue for feedback %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
