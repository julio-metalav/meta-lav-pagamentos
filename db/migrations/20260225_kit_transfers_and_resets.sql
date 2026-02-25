-- Migration: kit_transfers + kit_resets (log de transferência e reconcile)
-- Meta-Lav Pagamentos — 2026-02-25
-- Kit = (pos_device_id + gateway_id) coeso; logs auditáveis.

begin;

-- Log de transferência de kit entre condomínios
create table if not exists public.kit_transfers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  admin_subject text null,
  from_condominio_id uuid not null,
  to_condominio_id uuid not null,
  pos_device_id uuid not null,
  gateway_id uuid not null,
  reason text null,
  metadata jsonb null
);

create index if not exists idx_kit_transfers_tenant_created
  on public.kit_transfers (tenant_id, created_at desc);

-- Log de reconcile/reset de pendências do kit
create table if not exists public.kit_resets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  admin_subject text null,
  condominio_id uuid not null,
  pos_device_id uuid not null,
  gateway_id uuid not null,
  reason text null,
  metadata jsonb null
);

create index if not exists idx_kit_resets_tenant_created
  on public.kit_resets (tenant_id, created_at desc);

-- Permissões para Kit (reconcile + transfer)
insert into public.admin_permissions(code, name)
values
  ('admin.kits.reconcile', 'Kits: reconciliar pendências'),
  ('admin.kits.transfer', 'Kits: transferir entre lojas')
on conflict (code) do nothing;

-- GESTOR recebe as novas permissões
insert into public.admin_role_permissions(role_id, permission_id)
select r.id, p.id
from public.admin_roles r
join public.admin_permissions p on p.code in ('admin.kits.reconcile', 'admin.kits.transfer')
where r.code = 'GESTOR'
on conflict do nothing;

commit;
