-- Meta-Lav Pagamentos
-- Migration: alert routes + dispatch log (multi-channel alerts from dashboard)
-- Date: 2026-02-10

begin;

create extension if not exists pgcrypto;

-- 1) Configuração de rotas de alerta (parametrizável via dashboard)
create table if not exists public.alert_routes (
  id uuid primary key default gen_random_uuid(),
  enabled boolean not null default true,
  event_code text not null default 'all',
  channel text not null,
  target text not null,
  severity_min text not null default 'warning',
  dedupe_window_sec integer not null default 900,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint alert_routes_channel_check
    check (channel in ('whatsapp', 'telegram', 'email', 'discord')),
  constraint alert_routes_severity_min_check
    check (severity_min in ('info', 'warning', 'critical')),
  constraint alert_routes_dedupe_window_sec_check
    check (dedupe_window_sec >= 0 and dedupe_window_sec <= 86400),
  constraint alert_routes_event_code_not_blank
    check (length(trim(event_code)) > 0),
  constraint alert_routes_target_not_blank
    check (length(trim(target)) > 0)
);

create index if not exists idx_alert_routes_enabled_event
  on public.alert_routes (enabled, event_code);

create index if not exists idx_alert_routes_channel_target
  on public.alert_routes (channel, target);

-- updated_at helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_alert_routes_set_updated_at on public.alert_routes;
create trigger trg_alert_routes_set_updated_at
before update on public.alert_routes
for each row
execute function public.set_updated_at();

-- 2) Log de despacho (auditoria + dedupe)
create table if not exists public.alert_dispatch_log (
  id uuid primary key default gen_random_uuid(),
  event_code text not null,
  severity text not null,
  fingerprint text not null,
  channel text not null,
  target text not null,
  status text not null,
  error text null,
  sent_at timestamptz not null default now(),

  constraint alert_dispatch_log_severity_check
    check (severity in ('info', 'warning', 'critical')),
  constraint alert_dispatch_log_channel_check
    check (channel in ('whatsapp', 'telegram', 'email', 'discord')),
  constraint alert_dispatch_log_status_check
    check (status in ('sent', 'failed', 'skipped_dedupe')),
  constraint alert_dispatch_log_event_code_not_blank
    check (length(trim(event_code)) > 0),
  constraint alert_dispatch_log_fingerprint_not_blank
    check (length(trim(fingerprint)) > 0),
  constraint alert_dispatch_log_target_not_blank
    check (length(trim(target)) > 0)
);

-- Índice principal para dedupe por janela de tempo
create index if not exists idx_alert_dispatch_dedupe
  on public.alert_dispatch_log (event_code, channel, target, fingerprint, sent_at desc);

-- Índice para observabilidade (timeline)
create index if not exists idx_alert_dispatch_timeline
  on public.alert_dispatch_log (sent_at desc);

-- Evita rotas duplicadas idênticas ativas por evento/canal/destino
create unique index if not exists uq_alert_routes_unique_route
  on public.alert_routes (event_code, channel, target);

commit;
