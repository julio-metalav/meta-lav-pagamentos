-- Meta-Lav Pagamentos
-- Migration: alert outbox (queue for OpenClaw dispatcher)
-- Date: 2026-02-10

begin;

create extension if not exists pgcrypto;

create table if not exists public.alert_outbox (
  id uuid primary key default gen_random_uuid(),
  event_code text not null,
  severity text not null,
  fingerprint text not null,
  channel text not null,
  target text not null,
  text text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz null,

  constraint alert_outbox_severity_check check (severity in ('info','warning','critical')),
  constraint alert_outbox_channel_check check (channel in ('whatsapp','telegram','email','discord')),
  constraint alert_outbox_status_check check (status in ('pending','sending','sent','failed','dead')),
  constraint alert_outbox_target_not_blank check (length(trim(target)) > 0),
  constraint alert_outbox_text_not_blank check (length(trim(text)) > 0)
);

create index if not exists idx_alert_outbox_status_created
  on public.alert_outbox (status, created_at asc);

create index if not exists idx_alert_outbox_fingerprint
  on public.alert_outbox (fingerprint, channel, target, created_at desc);

create unique index if not exists uq_alert_outbox_pending_fingerprint
  on public.alert_outbox (fingerprint, channel, target)
  where status in ('pending','sending');

create or replace function public.set_updated_at_alert_outbox()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_alert_outbox_set_updated_at on public.alert_outbox;
create trigger trg_alert_outbox_set_updated_at
before update on public.alert_outbox
for each row
execute function public.set_updated_at_alert_outbox();

commit;
