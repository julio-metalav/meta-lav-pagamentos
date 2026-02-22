-- DECISÃO 1: Idempotência do POS por (tenant_id, pos_device_id, client_request_id). NÃO global por tenant.
-- Ordem: rodar após 20260221_authorize_client_request_id.sql (que só adiciona a coluna client_request_id).

-- Remover índice global (tenant_id, client_request_id) se existir — evita colisão entre POS distintos.
drop index if exists public.pagamentos_tenant_client_request_id_key;

alter table public.pagamentos
  add column if not exists pos_device_id uuid references public.pos_devices(id),
  add column if not exists pos_serial text;

comment on column public.pagamentos.pos_device_id is 'POS que criou o pagamento (obrigatório para origem=POS no runtime).';
comment on column public.pagamentos.pos_serial is 'Serial do POS (pos_devices.serial) ou identificador do app; usado no índice de idempotência quando pos_device_id é null.';

-- Índice 1: idempotência por dispositivo POS — mesmo (tenant, device, client_request_id) = mesmo pagamento.
create unique index if not exists pagamentos_tenant_pos_device_client_request_key
  on public.pagamentos (tenant_id, pos_device_id, client_request_id)
  where client_request_id is not null and pos_device_id is not null;

-- Índice 2: fallback quando pos_device_id é null (ex.: fluxo APP) — por (tenant, pos_serial, client_request_id).
create unique index if not exists pagamentos_tenant_pos_serial_client_request_key
  on public.pagamentos (tenant_id, pos_serial, client_request_id)
  where client_request_id is not null and pos_device_id is null and pos_serial is not null;
