<-- DECISÃO 2: RPC transacional para atomicidade (confirm + ciclo + iot_command).
-- Lock por provider_ref (se existir) ou payment_id. Idempotente.

create or replace function public.rpc_confirm_and_enqueue(
  p_payment_id uuid,
  p_tenant_id uuid,
  p_condominio_maquinas_id uuid,
  p_idempotency_key text,
  p_provider_ref text default null,
  p_provider text default 'stone',
  p_result text default 'approved',
  p_channel text default 'pos',
  p_origin jsonb default '{}'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_key bigint;
  v_pay record;
  v_machine record;
  v_ciclo_id uuid;
  v_cmd_id uuid;
  v_iot_id uuid;
  v_gateway text;
  v_already boolean := false;
  v_now timestamptz := now();
  v_expires_at timestamptz := v_now + interval '5 minutes';
  v_gateway_enum text := case when lower(p_provider) = 'asaas' then 'ASAAS' else 'STONE' end;
begin
  -- Lock: provider_ref se existir, senão payment_id
  v_lock_key := hashtext(coalesce(p_provider_ref, p_payment_id::text));
  perform pg_advisory_xact_lock(v_lock_key);

  -- Pagamento FOR UPDATE
  select id, status, condominio_id, external_id
    into v_pay
    from pagamentos
   where id = p_payment_id and tenant_id = p_tenant_id
   for update;

  if not found then
    return json_build_object('ok', false, 'error', 'payment_not_found');
  end if;

  -- Opcional: marcar PAGO dentro da mesma transação
  -- NOTE: status é enum (pag_status). Comparar diretamente, sem upper().
  if v_pay.status <> 'PAGO'::pag_status and p_provider_ref is not null and lower(p_result) = 'approved' then
    update pagamentos
       set status = 'PAGO'::pag_status,
           external_id = p_provider_ref,
           paid_at = v_now,
           gateway_pagamento = v_gateway_enum
     where id = p_payment_id and tenant_id = p_tenant_id;

  elsif v_pay.status <> 'PAGO'::pag_status then
    return json_build_object('ok', false, 'error', 'payment_not_confirmed', 'payment_id', p_payment_id);
  end if;

  -- Máquina
  select id, gateway_id, condominio_id, identificador_local, tipo
    into v_machine
    from condominio_maquinas
   where id = p_condominio_maquinas_id and tenant_id = p_tenant_id and ativa = true;

  if not found then
    return json_build_object('ok', false, 'error', 'machine_not_found');
  end if;
  if v_machine.condominio_id <> v_pay.condominio_id then
    return json_build_object('ok', false, 'error', 'machine_condominio_mismatch');
  end if;
  if v_machine.gateway_id is null then
    return json_build_object('ok', false, 'error', 'missing_gateway_id');
  end if;

  -- Ciclo: reusar ou criar
  select id into v_ciclo_id
    from ciclos
   where tenant_id = p_tenant_id and pagamento_id = p_payment_id and maquina_id = v_machine.id
   order by created_at desc limit 1;

  if v_ciclo_id is null then
    insert into ciclos (tenant_id, pagamento_id, condominio_id, maquina_id, status, created_at, updated_at)
    values (p_tenant_id, p_payment_id, v_pay.condominio_id, v_machine.id, 'AGUARDANDO_LIBERACAO', v_now, v_now)
    returning id into v_ciclo_id;
  end if;

  -- iot_command: reusar por execute_idempotency_key + ciclo_id no payload
  select id, cmd_id into v_iot_id, v_cmd_id
    from iot_commands
   where tenant_id = p_tenant_id
     and gateway_id = v_machine.gateway_id
     and payload->>'execute_idempotency_key' = p_idempotency_key
     and payload->>'ciclo_id' = v_ciclo_id::text
   order by created_at desc limit 1;

  if v_iot_id is not null then
    v_already := true;
  else
    v_cmd_id := gen_random_uuid();
    insert into iot_commands (tenant_id, gateway_id, cmd_id, pagamento_id, tipo, payload, condominio_maquinas_id, status, expires_at, created_at)
    values (
      p_tenant_id,
      v_machine.gateway_id,
      v_cmd_id,
      p_payment_id,
      'PULSE',
      jsonb_build_object(
        'pulses', 1,
        'ciclo_id', v_ciclo_id,
        'pagamento_id', p_payment_id,
        'execute_idempotency_key', p_idempotency_key,
        'identificador_local', v_machine.identificador_local,
        'tipo_maquina', v_machine.tipo,
        'channel', p_channel,
        'origin', p_origin
      ),
      v_machine.id,
      'PENDENTE',
      v_expires_at,
      v_now
    )
    returning id into v_iot_id;
  end if;

  return json_build_object(
    'ok', true,
    'pagamento_id', p_payment_id,
    'pagamento_status', (select status from pagamentos where id = p_payment_id),
    'ciclo_id', v_ciclo_id,
    'ciclo_status', 'AGUARDANDO_LIBERACAO',
    'iot_command_id', v_iot_id,
    'command_id', v_cmd_id,
    'iot_command_status', 'PENDENTE',
    'already_processed', v_already
  );
end;
$$;

comment on function public.rpc_confirm_and_enqueue(uuid,uuid,uuid,text,text,text,text,text,jsonb) is
  'Transacional: lock + opcional PAGO + ciclo + iot_command. Idempotente por execute_idempotency_key+ciclo_id.';>
