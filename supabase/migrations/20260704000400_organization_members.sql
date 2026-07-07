-- Which users belong to which org, and at what permission level.
create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'coach', 'viewer')),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, user_id)
);

comment on table public.organization_members is
  'Org-level roles. Simple fixed set (owner/admin/coach/viewer) intentionally — no custom permission engine until customers prove it is needed.';

-- Whoever creates an organization automatically becomes its owner.
-- Runs as security definer so it bypasses RLS and can't be raced by the client
-- doing two separate inserts.
create function public.handle_new_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into public.organization_members (organization_id, user_id, role)
    values (new.id, new.created_by, 'owner');
  end if;
  return new;
end;
$$;

create trigger on_organization_created
  after insert on public.organizations
  for each row execute function public.handle_new_organization();
