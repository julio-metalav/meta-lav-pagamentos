export type MachineState = "LIVRE" | "OCUPADA" | "RESERVADA" | "INDISPONIVEL";
export type PaymentState =
  | "PAGO"
  | "ESTORNO_PENDENTE"
  | "ESTORNADO"
  | "ESTORNO_FALHOU";

export function machineStateColor(state: MachineState) {
  switch (state) {
    case "LIVRE":
      return "#16A34A";
    case "OCUPADA":
      return "#DC2626";
    case "RESERVADA":
      return "#F59E0B";
    case "INDISPONIVEL":
      return "#6B7280";
    default:
      return "#6B7280";
  }
}

export function paymentStateColor(state: PaymentState) {
  switch (state) {
    case "PAGO":
      return "#2563EB";
    case "ESTORNO_PENDENTE":
      return "#F59E0B";
    case "ESTORNADO":
      return "#16A34A";
    case "ESTORNO_FALHOU":
      return "#DC2626";
    default:
      return "#6B7280";
  }
}
