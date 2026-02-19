-- Migration: kits_operacionais
-- Data: 2026-02-18
-- Descrição: Cria tabela kits_operacionais e adiciona coluna kit_id em condominio_maquinas

-- Criar tabela kits_operacionais
CREATE TABLE IF NOT EXISTS kits_operacionais (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominio_id UUID NOT NULL REFERENCES condominios(id),
    nome_kit TEXT NOT NULL,
    pos_device_id UUID NOT NULL REFERENCES pos_devices(id),
    gateway_id UUID NOT NULL REFERENCES gateways(id),
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Unicidade apenas para kits ATIVOS (permite troca/histórico)
CREATE UNIQUE INDEX IF NOT EXISTS uq_kits_pos_device_active
ON kits_operacionais (pos_device_id)
WHERE ativo = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_kits_gateway_active
ON kits_operacionais (gateway_id)
WHERE ativo = true;

-- Adicionar coluna kit_id em condominio_maquinas
ALTER TABLE condominio_maquinas
ADD COLUMN IF NOT EXISTS kit_id UUID REFERENCES kits_operacionais(id);
