export const PERMISSIONS = [
  { code: "dashboard.read", name: "Dashboard operacional" },
  { code: "alerts.routes.read", name: "Alert routes: ler" },
  { code: "alerts.routes.write", name: "Alert routes: editar" },
  { code: "alerts.dlq.read", name: "DLQ: ler" },
  { code: "alerts.dlq.replay", name: "DLQ: replay" },
  { code: "admin.users.read", name: "Usuários: ler" },
  { code: "admin.users.write", name: "Usuários: gerenciar" },
  { code: "admin.gateways.read", name: "Gateways: ler" },
  { code: "admin.gateways.write", name: "Gateways: editar" },
  { code: "admin.pos_devices.read", name: "POS devices: ler" },
  { code: "admin.pos_devices.write", name: "POS devices: editar" },
  { code: "admin.maquinas.read", name: "Máquinas: ler" },
  { code: "admin.maquinas.write", name: "Máquinas: editar" },
  { code: "admin.condominios.read", name: "Condomínios: ler" },
  { code: "admin.condominios.write", name: "Condomínios: editar" },
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number]["code"];
