-- Impede comandos simultâneos com mesma chave de idempotência para o mesmo gateway/pagamento
CREATE UNIQUE INDEX IF NOT EXISTS iot_commands_execute_key_unique
  ON public.iot_commands (gateway_id, pagamento_id)
  WHERE (payload->>'execute_idempotency_key') IS NOT NULL;
