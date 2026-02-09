// Fonte da verdade runtime (PT-BR)
export const RUNTIME_TABLES = {
  iot_commands: "iot_commands",
  eventos_iot: "eventos_iot",
  gateways: "gateways",
  condominio_maquinas: "condominio_maquinas",
  pagamentos: "pagamentos",
  ciclos: "ciclos",
  precos_ciclo: "precos_ciclo",
} as const;

export type RuntimeTableName = (typeof RUNTIME_TABLES)[keyof typeof RUNTIME_TABLES];
