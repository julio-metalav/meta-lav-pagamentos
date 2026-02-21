-- =============================================================================
-- E2E Staging: checagem e correção de máquina para /api/pos/authorize
-- Ver RUNBOOK_E2E_APP.md ITEM 2 (machine_not_found).
--
-- Como usar:
-- 1. Substitua EM TODO O ARQUIVO (Ctrl+H):
--    STAGING_POS_SERIAL         → valor do secret (ex: POS-TESTE-001)
--    STAGING_IDENTIFICADOR_LOCAL → valor do secret (ex: LAV-01)
-- 2. Rode a PARTE 1 no Supabase SQL Editor (projeto Staging).
-- 3. Se a máquina existir mas ativa = false → rode PARTE 2a.
-- 4. Se a máquina não existir → rode PARTE 2b (precisa de um gateway do condomínio).
-- 5. Se a máquina existir mas pos_device_id errado/NULL → rode PARTE 2c.
-- 6. O id retornado em 1.2 deve ser o secret STAGING_CONDOMINIO_MAQUINAS_ID.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PARTE 1 — DIAGNÓSTICO (rode primeiro)
-- -----------------------------------------------------------------------------

-- 1.1 POS: existe e qual condomínio?
SELECT id AS pos_id, serial AS pos_serial, condominio_id AS pos_condominio_id
FROM pos_devices
WHERE serial = 'STAGING_POS_SERIAL';

-- 1.2 Máquina: existe e está ativa?
SELECT id AS maquina_id, condominio_id, identificador_local, ativa, pos_device_id, gateway_id
FROM condominio_maquinas
WHERE condominio_id = (SELECT condominio_id FROM pos_devices WHERE serial = 'STAGING_POS_SERIAL' LIMIT 1)
  AND identificador_local = 'STAGING_IDENTIFICADOR_LOCAL';

-- 1.3 Gateways do mesmo condomínio (para INSERT se máquina não existir)
SELECT id AS gateway_id, serial, condominio_id
FROM gateways
WHERE condominio_id = (SELECT condominio_id FROM pos_devices WHERE serial = 'STAGING_POS_SERIAL' LIMIT 1);

-- Resumo: se 1.1 retornar vazio → cadastre o POS (ou corrija STAGING_POS_SERIAL).
--         se 1.2 retornar vazio → use a parte 2b (INSERT).
--         se 1.2 retornar ativa = false → use a parte 2a (UPDATE).

-- -----------------------------------------------------------------------------
-- PARTE 2a — CORREÇÃO: reativar máquina existente (ativa = false → true)
-- -----------------------------------------------------------------------------
-- Só rode se o diagnóstico 1.2 mostrou uma linha com ativa = false.

/*
UPDATE condominio_maquinas
SET ativa = true, updated_at = now()
WHERE condominio_id = (SELECT condominio_id FROM pos_devices WHERE serial = 'STAGING_POS_SERIAL' LIMIT 1)
  AND identificador_local = 'STAGING_IDENTIFICADOR_LOCAL';
*/

-- -----------------------------------------------------------------------------
-- PARTE 2b — CORREÇÃO: criar máquina se não existir
-- -----------------------------------------------------------------------------
-- Exige: POS existe (1.1), pelo menos um gateway do mesmo condomínio (1.3).
-- Ajuste 'LAVADORA' se seu schema usar outro tipo.

/*
INSERT INTO condominio_maquinas (id, condominio_id, identificador_local, tipo, gateway_id, pos_device_id, ativa)
SELECT
  gen_random_uuid(),
  pd.condominio_id,
  'STAGING_IDENTIFICADOR_LOCAL',
  'LAVADORA',
  g.id,
  pd.id,
  true
FROM pos_devices pd
CROSS JOIN LATERAL (
  SELECT id FROM gateways WHERE condominio_id = pd.condominio_id LIMIT 1
) g
WHERE pd.serial = 'STAGING_POS_SERIAL'
  AND NOT EXISTS (
    SELECT 1 FROM condominio_maquinas cm
    WHERE cm.condominio_id = pd.condominio_id
      AND cm.identificador_local = 'STAGING_IDENTIFICADOR_LOCAL'
  );
*/

-- -----------------------------------------------------------------------------
-- PARTE 2c — Vincular máquina ao POS (se pos_device_id estiver NULL ou errado)
-- -----------------------------------------------------------------------------
-- Use se a máquina existir mas não estiver vinculada ao POS usado no CI.

/*
UPDATE condominio_maquinas cm
SET pos_device_id = pd.id, updated_at = now()
FROM pos_devices pd
WHERE cm.condominio_id = pd.condominio_id
  AND cm.identificador_local = 'STAGING_IDENTIFICADOR_LOCAL'
  AND pd.serial = 'STAGING_POS_SERIAL';
*/

-- -----------------------------------------------------------------------------
-- Após qualquer UPDATE/INSERT: confira o id da máquina para STAGING_CONDOMINIO_MAQUINAS_ID
-- -----------------------------------------------------------------------------
-- SELECT id FROM condominio_maquinas
-- WHERE condominio_id = (SELECT condominio_id FROM pos_devices WHERE serial = 'STAGING_POS_SERIAL' LIMIT 1)
--   AND identificador_local = 'STAGING_IDENTIFICADOR_LOCAL';
-- Esse id deve ser o valor do secret GitHub STAGING_CONDOMINIO_MAQUINAS_ID.
