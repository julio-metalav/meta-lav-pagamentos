-- Impede múltiplos ciclos ativos para o mesmo pagamento+máquina
CREATE UNIQUE INDEX IF NOT EXISTS ciclos_pagamento_maquina_active_unique
  ON public.ciclos (pagamento_id, maquina_id)
  WHERE status IN ('AGUARDANDO_LIBERACAO','EM_USO');
