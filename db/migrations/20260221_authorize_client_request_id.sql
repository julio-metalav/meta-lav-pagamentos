-- FASE0/FASE1: Idempotência authorize — apenas coluna. Índices UNIQUE por (tenant+device+client_request_id) na 20260222.
-- NÃO criar índice global (tenant_id, client_request_id) para evitar colisão entre POS distintos.
alter table public.pagamentos
  add column if not exists client_request_id text;

comment on column public.pagamentos.client_request_id is 'Idempotency key from client (POS/APP); uniqueness is per (tenant_id, pos_device_id, client_request_id) or (tenant_id, pos_serial, client_request_id).';
