-- Meta-Lav Pagamentos
-- Migration: alert DLQ (dead-letter queue) for failed alert dispatch
-- Date: 2026-02-10

begin;

create extension if not exists pgcrypto;

create table if not exists public.alert_dlq (
  id uuid primary key default gen_random_uuid(),
  event_code text not null,
  severity text not null,
  channel text not null,
  target text not null,
  payload jsonb not null,
  fingerprint text not null,
  error text not null,
  attempts integer not null default 0,
  status text not null default 'pending',
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  next_retry_at timestamptz not null default now(),
  resolved_at timestamptz null,
  resolved_by text null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint alert_dlq_event_code_not_blank
    check (length(trim(event_code)) > 0),
  constraint alert_dlq_severity_check
    check (severity in ('info', 'warning', 'critical')),
  constraint alert_dlq_channel_check
    check (channel in ('whatsapp', 'telegram', 'email', 'discord')),
  constraint alert_dlq_target_not_blank
    check (length(trim(target)) > 0),
  constraint alert_dlq_fingerprint_not_blank
    check (length(trim(fingerprint)) > 0),
  constraint alert_dlq_attempts_check
    check (attempts >= 0),
  constraint alert_dlq_status_check
    check (status in ('pending', 'retrying', 'resolved', 'dead'))
);

create index if not exists idx_alert_dlq_status_next_retry
  on public.alert_dlq (status, next_retry_at asc);

create index if not exists idx_alert_dlq_event_channel_target
  on public.alert_dlq (event_code, channel, target, created_at desc);

create index if not exists idx_alert_dlq_fingerprint
  on public.alert_dlq (fingerprint, created_at desc);

create unique index if not exists uq_alert_dlq_active_fingerprint_route
  on public.alert_dlq (fingerprint, channel, target)
  where status in ('pending', 'retrying');

create or replace function public.set_updated_at_alert_dlq()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_alert_dlq_set_updated_at on public.alert_dlq;
create trigger trg_alert_dlq_set_updated_at
before update on public.alert_dlq
for each row
execute function public.set_updated_at_alert_dlq();

commit;
