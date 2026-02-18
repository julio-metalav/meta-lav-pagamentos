alter table public.condominio_maquinas
  add constraint condominio_maquinas_condominio_identificador_key
  unique (condominio_id, identificador_local);
