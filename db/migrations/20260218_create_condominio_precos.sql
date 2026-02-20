-- Migration: condominio_precos (precificação por máquina com agendamento futuro)
-- Data: 2026-02-18
-- Descrição: Enum preco_canal + tabela condominio_precos com FK e índice de resolução

-- Enum canal de preço (POS, APP)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'preco_canal') THEN
    CREATE TYPE preco_canal AS ENUM ('POS', 'APP');
  END IF;
END
$$;

-- Tabela de preços por máquina e canal, com vigência a partir de
CREATE TABLE IF NOT EXISTS condominio_precos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_maquina_id UUID NOT NULL REFERENCES condominio_maquinas(id) ON DELETE CASCADE,
  canal preco_canal NOT NULL,
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos >= 0),
  vigente_a_partir TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL
);

-- Índice para resolver preço vigente por (máquina, canal, vigência desc)
CREATE INDEX IF NOT EXISTS idx_preco_resolver
  ON condominio_precos (condominio_maquina_id, canal, vigente_a_partir DESC);
