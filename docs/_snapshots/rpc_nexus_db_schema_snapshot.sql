-- docs/_snapshots/rpc_nexus_db_schema_snapshot.sql
-- Objetivo: expor um RPC somente leitura para snapshot do schema (Dashboard Nexus).
-- Aplicação manual via Supabase SQL Editor.
-- NÃO rodar DDL automático em pipelines — manter humano no loop.

-- Passos sugeridos:
-- 1. Abrir o SQL Editor do projeto Supabase.
-- 2. Colar o conteúdo abaixo (ajustar schema se necessário).
-- 3. Executar e versionar a alteração no repositório de infra correspondente.
-- 4. Garantir que apenas roles de leitura (service_role/read_only_api) tenham EXECUTE.

create or replace function public.nexus_db_schema_snapshot(
    target_schema text,
    target_tables text[]
) returns table (
    table_name text,
    column_name text,
    data_type text,
    udt_name text,
    is_nullable boolean,
    column_default text,
    ordinal_position integer,
    is_identity boolean,
    enum_values text[]
) language sql
  security definer
  set search_path = public, pg_catalog
as $$
  with cols as (
    select
      c.table_name,
      c.column_name,
      c.data_type,
      c.udt_name,
      (c.is_nullable = 'YES') as is_nullable,
      c.column_default,
      c.ordinal_position,
      (c.is_identity = 'YES') as is_identity
    from information_schema.columns c
    where c.table_schema = target_schema
      and (target_tables is null or c.table_name = any(target_tables))
  ), enums as (
    select
      t.typname as enum_name,
      array_agg(e.enumlabel order by e.enumsortorder) as values
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = target_schema
    group by 1
  )
  select
    cols.table_name,
    cols.column_name,
    cols.data_type,
    cols.udt_name,
    cols.is_nullable,
    cols.column_default,
    cols.ordinal_position,
    cols.is_identity,
    enums.values
  from cols
  left join enums on enums.enum_name = cols.udt_name
  order by cols.table_name, cols.ordinal_position;
$$;

comment on function public.nexus_db_schema_snapshot is 'Snapshot determinístico do schema (read-only) para Dashboard Nexus.';

-- Grants sugeridos (ajustar conforme roles disponíveis):
-- grant execute on function public.nexus_db_schema_snapshot(text, text[]) to service_role;
-- grant execute on function public.nexus_db_schema_snapshot(text, text[]) to authenticated;
