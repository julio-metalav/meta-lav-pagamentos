export const IOT_COMMAND_STATUS = {
  PENDENTE: "PENDENTE",
  pendente: "pendente",
  enviado: "enviado",
  ack: "ack",
  erro: "erro",
} as const;

export type IotCommandStatus = (typeof IOT_COMMAND_STATUS)[keyof typeof IOT_COMMAND_STATUS];
