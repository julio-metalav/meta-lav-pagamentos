-- Migration: Garantir admin.condominios.read e admin.condominios.write ao role GESTOR
-- Meta-Lav Pagamentos — 2026-02-25
-- Corrige 403 em /admin/lojas e /admin/lojas/nova quando usuário tem apenas role GESTOR
-- e por algum motivo não possui esses vínculos em admin_role_permissions.

begin;

-- Garantir que as permissões existam (idempotente)
insert into public.admin_permissions(code, name)
values
  ('admin.condominios.read', 'Condomínios: ler'),
  ('admin.condominios.write', 'Condomínios: editar')
on conflict (code) do nothing;

-- Vincular ao role GESTOR (idempotente)
insert into public.admin_role_permissions(role_id, permission_id)
select r.id, p.id
from public.admin_roles r
join public.admin_permissions p on p.code in ('admin.condominios.read', 'admin.condominios.write')
where r.code = 'GESTOR'
on conflict do nothing;

commit;
