BEGIN;

ALTER TABLE public.condominio_maquinas
  ADD COLUMN IF NOT EXISTS delivery_mode text NOT NULL DEFAULT 'ACK_ONLY';

ALTER TABLE public.condominio_maquinas
  ADD COLUMN IF NOT EXISTS delivery_timeout_ack_sec integer NOT NULL DEFAULT 10;

ALTER TABLE public.condominio_maquinas
  ADD COLUMN IF NOT EXISTS delivery_timeout_busy_sec integer NOT NULL DEFAULT 15;

DO $$
BEGIN
  ALTER TABLE public.condominio_maquinas
    ADD CONSTRAINT condominio_maquinas_delivery_mode_check
    CHECK (delivery_mode IN ('ACK_ONLY', 'BUSY_REQUIRED', 'ACK_PLUS_BUSY'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.condominio_maquinas
    ADD CONSTRAINT condominio_maquinas_delivery_timeout_ack_check
    CHECK (delivery_timeout_ack_sec BETWEEN 1 AND 120);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.condominio_maquinas
    ADD CONSTRAINT condominio_maquinas_delivery_timeout_busy_check
    CHECK (delivery_timeout_busy_sec BETWEEN 1 AND 300);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
