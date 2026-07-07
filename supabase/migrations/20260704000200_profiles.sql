-- App-facing user profile, 1:1 with auth.users.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  first_name text,
  last_name text,
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'App-facing user profile, one row per auth.users row. Created automatically on signup via trigger below.';

-- Auto-create a profile row whenever a new auth user signs up (magic link).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
