-- Admin RBAC + invite/reset tokens
-- Meta-Lav Pagamentos
-- 2026-02-11

begin;

create extension if not exists pgcrypto;

-- Users
create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text null,
  enabled boolean not null default true,
  status text not null default 'invited',
  password_hash text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz null,

  constraint admin_users_email_not_blank check (length(trim(email)) > 3),
  constraint admin_users_status_check check (status in ('invited','active','disabled'))
);

-- Roles
create table if not exists public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_user_roles (
  user_id uuid not null references public.admin_users(id) on delete cascade,
  role_id uuid not null references public.admin_roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

-- Permissions
create table if not exists public.admin_permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_role_permissions (
  role_id uuid not null references public.admin_roles(id) on delete cascade,
  permission_id uuid not null references public.admin_permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

-- Optional per-user overrides (allow/deny)
create table if not exists public.admin_user_permissions (
  user_id uuid not null references public.admin_users(id) on delete cascade,
  permission_id uuid not null references public.admin_permissions(id) on delete cascade,
  allowed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, permission_id)
);

-- One-time tokens for invite/reset
create table if not exists public.admin_auth_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.admin_users(id) on delete cascade,
  type text not null,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz null,
  created_at timestamptz not null default now(),
  created_by uuid null references public.admin_users(id) on delete set null,

  constraint admin_auth_tokens_type_check check (type in ('invite','reset')),
  constraint admin_auth_tokens_hash_not_blank check (length(trim(token_hash)) > 10)
);

create index if not exists idx_admin_auth_tokens_user_type
  on public.admin_auth_tokens (user_id, type, created_at desc);

create index if not exists idx_admin_auth_tokens_hash
  on public.admin_auth_tokens (token_hash);

-- Audit log (minimal)
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid null references public.admin_users(id) on delete set null,
  action text not null,
  target_user_id uuid null references public.admin_users(id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint admin_audit_action_not_blank check (length(trim(action)) > 0)
);

-- updated_at triggers
create or replace function public._set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_admin_users_updated_at on public.admin_users;
create trigger trg_admin_users_updated_at
before update on public.admin_users
for each row
execute function public._set_updated_at();

drop trigger if exists trg_admin_user_permissions_updated_at on public.admin_user_permissions;
create trigger trg_admin_user_permissions_updated_at
before update on public.admin_user_permissions
for each row
execute function public._set_updated_at();

-- Seed roles
insert into public.admin_roles(code,name)
values
  ('GESTOR','Gestor'),
  ('ADMIN','Admin')
on conflict (code) do nothing;

-- Seed permissions (minimal, expand later)
insert into public.admin_permissions(code,name)
values
  ('dashboard.read','Dashboard operacional'),
  ('alerts.routes.read','Alert routes: ler'),
  ('alerts.routes.write','Alert routes: editar'),
  ('alerts.dlq.read','DLQ: ler'),
  ('alerts.dlq.replay','DLQ: replay'),
  ('admin.users.read','Usuários: ler'),
  ('admin.users.write','Usuários: gerenciar'),
  ('admin.gateways.read','Gateways: ler'),
  ('admin.gateways.write','Gateways: editar'),
  ('admin.pos_devices.read','POS devices: ler'),
  ('admin.pos_devices.write','POS devices: editar'),
  ('admin.maquinas.read','Máquinas: ler'),
  ('admin.maquinas.write','Máquinas: editar'),
  ('admin.condominios.read','Condomínios: ler'),
  ('admin.condominios.write','Condomínios: editar')
on conflict (code) do nothing;

-- GESTOR gets all permissions
insert into public.admin_role_permissions(role_id, permission_id)
select r.id, p.id
from public.admin_roles r
cross join public.admin_permissions p
where r.code='GESTOR'
on conflict do nothing;

commit;
